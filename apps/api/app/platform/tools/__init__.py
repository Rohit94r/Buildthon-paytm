"""Tool registry: every capability an agent uses to touch the outside world or the workspace's data goes through
`invoke()`, which checks the agent may use the tool, applies timeout + retries, writes `tool.called` /
`tool.result` execution events (redacted) and audits side effects. Agent kinds never call the network,
datasets or connections directly."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from app.queue.jobs import JobError, PermanentError


@dataclass(frozen=True)
class ToolInfo:
    key: str
    name: str
    description: str
    category: str
    permissions: list[str]
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    requires_connection: list[str] | None = None
    timeout_s: int = 60
    retries: int = 0
    side_effects: bool = False
    version: str = "1.0.0"

    def out(self) -> dict[str, Any]:
        return {"key": self.key, "name": self.name, "description": self.description, "version": self.version,
                "category": self.category, "input_schema": self.input_schema, "output_schema": self.output_schema,
                "permissions": self.permissions, "requires_connection": self.requires_connection, "timeout_s": self.timeout_s,
                "retries": self.retries, "side_effects": self.side_effects}


def _obj(**props: Any) -> dict[str, Any]:
    return {"type": "object", "properties": props}


S = {"type": "string"}
N = {"type": "number"}
B = {"type": "boolean"}
ARR = {"type": "array"}
OBJ = {"type": "object"}

TOOLS: dict[str, ToolInfo] = {
    t.key: t
    for t in (
        ToolInfo("web.fetch", "Fetch a web page", "GET a public URL through the polite fetcher (SSRF guard, robots.txt, rate limits, size cap).",
                 "web", ["network:public"], _obj(url=S, robots=B), _obj(status=N, url=S, bytes=N), timeout_s=45, retries=1),
        ToolInfo("web.search", "Search the web", "News search via Google News RSS; DuckDuckGo Lite HTML only where robots.txt allows.",
                 "web", ["network:public"], _obj(query=S, engine=S, limit=N), _obj(results=ARR), timeout_s=45, retries=1),
        ToolInfo("rss.read", "Read a feed", "Fetch and parse an RSS/Atom feed.", "web", ["network:public"], _obj(url=S), _obj(items=ARR),
                 timeout_s=45, retries=1),
        ToolInfo("sitemap.read", "Read a sitemap", "Fetch a sitemap (or sitemap index) and list page URLs.", "web", ["network:public"],
                 _obj(url=S, limit=N), _obj(urls=ARR), timeout_s=45, retries=1),
        ToolInfo("html.extract", "Extract article text", "Main text, title, date and image of an article page.", "web", [],
                 _obj(url=S), _obj(title=S, text=S), timeout_s=30),
        ToolInfo("ai.extract", "AI field extraction", "Ask the model to fill typed fields from page text (nulls when unknown).", "ai",
                 ["model"], _obj(fields=ARR, text=S), _obj(values=OBJ), timeout_s=300),
        ToolInfo("seo.analyze", "On-page SEO analysis", "Title, meta, H1, canonical, Open Graph, JSON-LD and link checks for one page.",
                 "seo", [], _obj(url=S), _obj(issues=ARR), timeout_s=30),
        ToolInfo("dataset.read", "Read dataset records", "Look up records of a workspace dataset.", "data", ["dataset:read"],
                 _obj(dataset_id=S, keys=ARR), _obj(records=ARR), timeout_s=30),
        ToolInfo("dataset.upsert", "Write dataset records", "Insert or update records by the dataset's key field.", "data",
                 ["dataset:write"], _obj(dataset_id=S, records=ARR), _obj(created=N, updated=N, skipped=N), timeout_s=60),
        ToolInfo("content.save", "Save content", "Create or update a content item (draft or approved per the pipeline).", "data",
                 ["content:write"], _obj(title=S, formats=OBJ), _obj(content_id=S), timeout_s=30),
        ToolInfo("publish.connection", "Publish to a connection", "Deliver content to Next.js, WordPress, Ghost, webhook, Telegram, LinkedIn…",
                 "publish", ["external:side_effect"], _obj(content_id=S, connection_ids=ARR), _obj(results=ARR),
                 requires_connection=["nextjs", "wordpress", "webhook", "linkedin", "telegram", "x", "ghost"], timeout_s=120,
                 side_effects=True),
        ToolInfo("http.request", "Call an API", "JSON request to an allowlisted REST API connection (CRM, Sheets, internal API).",
                 "integration", ["external:side_effect", "network:allowlisted"], _obj(connection_id=S, method=S, path=S, body=OBJ),
                 _obj(status=N, body=OBJ), requires_connection=["rest_api"], timeout_s=60, retries=1, side_effects=True),
        ToolInfo("notify.send", "Send a notification", "Message to Telegram, Slack, Discord, email (SMTP) or a webhook.", "notify",
                 ["external:side_effect"], _obj(connection_id=S, text=S, subject=S), _obj(ok=B),
                 requires_connection=["telegram", "slack", "discord", "email_smtp", "webhook"], timeout_s=60, retries=1, side_effects=True),
        ToolInfo("image.discover", "Find a lead image", "og:image / JSON-LD / page images with dimensions and credit.", "web",
                 ["network:public"], _obj(url=S), _obj(url=S, width=N, height=N, credit=S), timeout_s=45),
        ToolInfo("links.collect", "Collect links", "Links on a page, made absolute and canonical (tracking stripped), with include/exclude patterns.",
                 "web", [], _obj(url=S, same_site=B, include=ARR, exclude=ARR), _obj(links=ARR), timeout_s=30),
        ToolInfo("doc.read", "Read a document", "Download a PDF (within the size cap) and extract its text page by page.", "web",
                 ["network:public"], _obj(url=S, max_pages=N), _obj(text=S, pages=N, title=S), timeout_s=120, retries=1),
        ToolInfo("image.search", "Search open-license images", "Openverse and Wikimedia Commons search with licence and credit.", "web",
                 ["network:public"], _obj(provider=S, query=S, limit=N), _obj(images=ARR), timeout_s=45, retries=1),
        ToolInfo("image.hash", "Fingerprint an image", "Download a thumbnail (size-capped) and compute a perceptual dHash.", "web",
                 ["network:public"], _obj(url=S), _obj(hash=S), timeout_s=30),
        ToolInfo("suggest.keywords", "Search suggestions", "Free autocomplete suggestions (Google, Bing as fallback) for a phrase.", "seo",
                 ["network:public"], _obj(query=S, language=S, region=S), _obj(suggestions=ARR), timeout_s=20),
        ToolInfo("model.generate", "Model call", "Schema-constrained generation with the workspace's model profile and fallback.", "ai",
                 ["model"], _obj(task=S, prompt=S), _obj(output=OBJ), timeout_s=900),
        # Beyond 9TO5 sponsor tools (SerpApi + You.com tracks)
        # The sponsor clients degrade to labelled sample data instead of raising, so retries are pointless;
        # timeouts match SPONSOR_TIMEOUT_S (12s) with a little headroom.
        ToolInfo("serpapi.search", "SerpApi live search",
                 "Real-time structured results from Google Web, News, Jobs, Shopping, Maps and Scholar via SerpApi.",
                 "web", ["network:public"], _obj(query=S, engine=S, location=S, gl=S, hl=S, count=N),
                 _obj(results=ARR), timeout_s=15),
        ToolInfo("serpapi.extract", "SerpApi Extract", "Main content of a page as Markdown via SerpApi's Extract API.",
                 "web", ["network:public"], _obj(url=S), _obj(url=S, text=S, degraded=B), timeout_s=15),
        ToolInfo("you.search", "You.com live search",
                 "Real-time web results with snippets and dates from the You.com Web Search API.",
                 "web", ["network:public"], _obj(query=S, count=N, freshness=S), _obj(results=ARR), timeout_s=15),
        ToolInfo("you.answer", "You.com cited answer",
                 "Synthesized answer with numbered inline citations from the You.com Answer API.",
                 "ai", ["network:public"], _obj(query=S, country=S, language=S), _obj(answer=S, citations=ARR),
                 timeout_s=15),
    )
}

KIND_TOOLS: dict[str, list[str]] = {
    "web_scraper": ["web.fetch", "rss.read", "sitemap.read", "html.extract", "ai.extract", "links.collect"],
    "news_monitor": ["web.fetch", "rss.read", "html.extract", "serpapi.search"],
    "persona_rewriter": ["model.generate", "content.save"],
    "multi_format": ["model.generate", "content.save"],
    "seo_optimizer": ["content.save"],
    "quality_gate": ["model.generate", "content.save"],
    "data_transform": ["model.generate"],
    "auto_publisher": ["content.save", "publish.connection"],
    "dataset_builder": ["web.fetch", "html.extract", "ai.extract", "dataset.upsert"],
    "comparison_assistant": ["dataset.read", "model.generate"],
    "custom_llm": ["model.generate"],
    "researcher": ["web.search", "web.fetch", "html.extract", "model.generate", "serpapi.search", "you.search", "you.answer"],
    "fact_checker": ["model.generate"],
    "site_auditor": ["web.fetch", "sitemap.read", "seo.analyze", "links.collect", "serpapi.search", "you.answer"],
    "image_finder": ["web.fetch", "image.discover", "image.search", "image.hash", "model.generate"],
    "change_detector": ["dataset.read", "dataset.upsert"],
    "http_action": ["http.request"],
    "notifier": ["notify.send"],
    "report_builder": ["model.generate", "content.save"],
    "link_collector": ["web.fetch", "sitemap.read", "links.collect"],
    "document_reader": ["web.fetch", "doc.read", "ai.extract"],
    "page_watcher": ["web.fetch", "html.extract"],
    "keyword_researcher": ["suggest.keywords", "web.fetch"],
    "comparer": ["dataset.read", "content.save"],
    "serpapi_search": ["serpapi.search", "serpapi.extract"],
    "you_research": ["you.answer", "you.search"],
}

Impl = Callable[..., Awaitable[Any]]
_IMPLS: dict[str, Impl] = {}


def tool(key: str) -> Callable[[Impl], Impl]:
    def deco(fn: Impl) -> Impl:
        _IMPLS[key] = fn
        return fn

    return deco


class ToolNotAllowed(PermanentError):
    pass


@dataclass
class ToolCall:
    key: str
    ok: bool
    duration_ms: int
    attempts: int
    summary: dict[str, Any] = field(default_factory=dict)


def allowed_tools(rctx) -> set[str]:
    # An explicit empty list means "no tools", not "use the defaults".
    tools = rctx.agent.tools if rctx.agent.tools is not None else KIND_TOOLS.get(rctx.agent.kind, [])
    return set(tools)


def _retryable(exc: Exception) -> bool:
    from app.platform.connections import DeliveryError
    from app.services.fetcher import FetchError

    if isinstance(exc, FetchError):
        return exc.kind in ("network", "rate_limited")
    if isinstance(exc, DeliveryError):
        return exc.retryable
    if isinstance(exc, JobError):
        return exc.retryable
    return isinstance(exc, TimeoutError)


async def invoke(rctx, key: str, summary: Callable[[Any], dict[str, Any]] | None = None, **args: Any) -> Any:
    """Run tool `key` for the agent in `rctx`. `summary(result)` turns the result into the small dict recorded
    on the `tool.result` event (results themselves can be large page bodies)."""
    from app.platform.tools import impl  # noqa: F401  (registers implementations)

    info = TOOLS.get(key)
    if info is None or key not in _IMPLS:
        raise PermanentError(f"Unknown tool '{key}'")
    if key not in allowed_tools(rctx):
        raise ToolNotAllowed(f"{rctx.agent.name} is not allowed to use the tool '{key}'")
    # Small scalar arguments only: page bodies and texts would bloat every event.
    shown = {k: v for k, v in args.items() if (isinstance(v, int | float | bool) or v is None or (isinstance(v, str) and len(v) <= 300))
             and k not in ("html", "text")}
    await rctx.event("tool.called", f"{info.name}" + (f": {shown.get('url') or shown.get('query') or ''}" if shown.get("url") or shown.get("query") else ""),
                     data={"tool": key, "args": shown})
    rctx.note_tool(key)
    started = time.perf_counter()
    attempts = 0
    while True:
        attempts += 1
        try:
            result = await asyncio.wait_for(_IMPLS[key](rctx, **args), timeout=info.timeout_s)
            break
        except Exception as exc:
            if attempts <= info.retries and _retryable(exc):
                await asyncio.sleep(min(2.0, 0.5 * attempts))
                continue
            ms = int((time.perf_counter() - started) * 1000)
            await rctx.event("tool.result", f"{info.name} failed: {str(exc)[:300] or exc.__class__.__name__}", level="warn",
                             data={"tool": key, "ok": False, "duration_ms": ms, "attempts": attempts})
            if isinstance(exc, TimeoutError):
                from app.queue.jobs import RetryableError

                raise RetryableError(f"Tool {key} timed out after {info.timeout_s}s") from exc
            raise
    ms = int((time.perf_counter() - started) * 1000)
    data = {"tool": key, "ok": True, "duration_ms": ms, "attempts": attempts}
    try:
        data.update(summary(result) if summary else {})
    except Exception:  # a summary must never break the call it describes
        pass
    await rctx.event("tool.result", f"{info.name} done in {ms} ms", data=data)
    if info.side_effects and rctx.persist:
        await rctx.audit_side_effect(key, data)
    return result
