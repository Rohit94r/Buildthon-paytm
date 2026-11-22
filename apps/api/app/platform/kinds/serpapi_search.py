"""SerpApi collector: structured, real-time results from Google Web / News / Jobs / Shopping / Maps / Scholar.

Track 1 integration. One agent can run several queries, de-duplicate by URL and optionally deepen the top N hits
with the SerpApi Extract API. Every call goes through the ``serpapi.*`` tools so runs get tool events and timeouts,
and offline runs fall back to labelled sample data instead of crashing.
"""

from __future__ import annotations

from typing import Any

from app.platform.flow import FlowItem
from app.platform.tools import invoke

ENGINES = ("google", "google_news", "google_jobs", "google_shopping", "google_maps", "google_scholar")


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    max_queries = max(1, min(int(cfg.get("max_queries", 5)), 10))
    queries = [q.strip() for q in (cfg.get("queries") or []) if isinstance(q, str) and q.strip()]
    if not queries and isinstance(cfg.get("query"), str) and cfg["query"].strip():
        queries = [cfg["query"].strip()]
    if not queries:
        queries = [it.title for it in items if it.title][:max_queries]
    if not queries:
        raise ValueError("Add a search query (or pass items whose titles are queries)")

    engine = cfg.get("engine", "google")
    if engine not in ENGINES:
        raise ValueError(f"Unsupported SerpApi engine '{engine}'")
    location, gl, hl = cfg.get("location", ""), cfg.get("gl", "in"), cfg.get("hl", "en")
    count = int(cfg.get("count", 10))
    extract_top = int(cfg.get("extract_top", 0))

    out: list[FlowItem] = []
    seen: set[str] = set()
    failed = 0
    for query in queries[:max_queries]:
        await ctx.check_cancel()
        try:
            hits = await invoke(
                ctx, "serpapi.search", summary=lambda r: {"results": len(r)},
                query=query, engine=engine, location=location, gl=gl, hl=hl, count=count,
            )
        except Exception as exc:  # one query failing must not kill the run
            failed += 1
            await ctx.log(f"SerpApi search failed for '{query[:80]}': {exc}", "warn")
            continue
        for hit in hits:
            url = str(hit.get("url") or "")
            key = url or str(hit.get("title") or "")
            if cfg.get("dedupe", True) and key in seen:
                continue
            seen.add(key)
            text = str(hit.get("summary") or "")
            if extract_top and len(out) < extract_top and url:
                try:
                    doc = await invoke(ctx, "serpapi.extract", summary=lambda d: {"bytes": len(d.get("text") or "")}, url=url)
                    if doc.get("text"):
                        text = str(doc["text"])[:8000]
                except Exception as exc:
                    await ctx.log(f"Extract skipped for {url[:100]}: {exc}", "warn")
            out.append(FlowItem(
                title=str(hit.get("title") or query),
                text=text,
                url=url or None,
                summary=str(hit.get("summary") or "")[:500],
                source_name=str(hit.get("source") or "") or None,
                published_at=hit.get("published_at"),
                data={
                    "engine": engine, "query": query, "position": hit.get("position"),
                    "provider": hit.get("provider"), "serp_extra": hit.get("extra") or {},
                },
            ))

    if failed and failed >= len(queries[:max_queries]):
        await ctx.log("Every SerpApi query failed; continuing with whatever the next step has", "warn")
    ctx.outputs["report"] = "\n".join(
        [f"# SerpApi {engine}", "", f"{len(out)} result(s) from {len(queries[:max_queries])} query/queries.", ""]
        + [f"{i}. [{it.title}]({it.url}) — {it.summary or ''}" for i, it in enumerate(out[:50], 1)]
    ).strip()
    await ctx.log(f"SerpApi {engine}: {len(out)} result(s), {len(seen)} unique")
    return out
