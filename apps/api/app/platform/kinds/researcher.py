"""researcher: a question or topic -> web search (Google News RSS, or DuckDuckGo Lite where robots.txt allows) +
configured sources -> fetch + extract -> an evidence pack with cited sources, built by the newsroom's research
synthesiser (numbers verified against their source). Output: one item per question with a cited markdown brief."""

from __future__ import annotations

import time
from typing import Any

from app.agents.research import synthesize
from app.platform.flow import FlowItem
from app.platform.kinds.common import fetch
from app.platform.tools import invoke
from app.services.canonical import canonicalize, publisher_from_url
from app.services.fetcher import FetchError
from app.services.sanitize import injection_flags
from app.services.text import word_count

SYSTEM = (
    "You are a meticulous research analyst. Build an evidence pack strictly from the provided sources. Every fact and "
    "number cites its source index; copy numbers exactly; never add outside knowledge."
)


def brief_markdown(question: str, pack: dict[str, Any]) -> str:
    lines = [f"# {question}", "", pack.get("summary") or "", "", "## Key facts", ""]
    for f in pack.get("key_facts") or []:
        flag = "" if f.get("confidence") != "needs_verification" else " *(verify)*"
        lines.append(f"- {f['claim']} [{f['source_index']}]{flag}")
    if pack.get("counterpoints"):
        lines += ["", "## Counterpoints", ""] + [f"- {c}" for c in pack["counterpoints"]]
    if pack.get("open_questions"):
        lines += ["", "## Open questions", ""] + [f"- {q}" for q in pack["open_questions"]]
    lines += ["", "## Sources", ""] + [f"{s['index']}. [{s.get('publisher') or s['url']}]({s['url']})" for s in pack.get("sources") or []]
    if pack.get("warnings"):
        lines += ["", "> " + " · ".join(pack["warnings"])]
    return "\n".join(lines).strip()


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    questions = [cfg["question"]] if cfg.get("question") else [it.title for it in items]
    if not questions:
        raise ValueError("Give the researcher a question (in its settings or as the run input)")
    out: list[FlowItem] = []
    for q in questions[:5]:
        await ctx.check_cancel()
        candidates: list[dict[str, Any]] = []
        if cfg.get("search", "google_news") != "none":
            try:
                candidates += await invoke(ctx, "web.search", summary=lambda r: {"results": len(r)}, query=q,
                                           engine=cfg.get("search", "google_news"), region=cfg.get("region", "IN"), limit=12)
            except FetchError as exc:
                await ctx.log(f"Search failed: {exc}", "warn")
        candidates += [{"url": s["url"], "title": None, "publisher": None} for s in cfg.get("sources") or []]
        candidates += [{"url": it.url, "title": it.title, "publisher": it.source_name} for it in items if it.url and it.title == q]

        sources: list[dict[str, Any]] = []
        seen: set[str] = set()
        for c in candidates:
            if len(sources) >= int(cfg.get("max_sources", 5)):
                break
            key = canonicalize(c["url"])
            if key in seen:
                continue
            seen.add(key)
            res = await fetch(ctx, c["url"])
            if res is None:
                continue
            ex = await invoke(ctx, "html.extract", summary=lambda e: {"words": e.word_count}, html=res.text, url=res.final_url or c["url"])
            if ex.paywalled or word_count(ex.text) < 60:
                continue
            sources.append({"index": len(sources) + 1, "url": res.final_url or c["url"], "title": ex.title or c.get("title"),
                            "publisher": c.get("publisher") or ex.sitename or publisher_from_url(c["url"]),
                            "published_at": ex.published_at.isoformat() if ex.published_at else None,
                            "excerpt": ex.text[:6000], "injection_flags": injection_flags(ex.text)})
        await ctx.log(f"'{q[:80]}': {len(sources)} usable source(s) from {len(candidates)} candidate(s)")
        if not sources:
            item = FlowItem(title=q, text="", flags=["insufficient_sources"], data={"sources": []})
            out.append(item)
            continue
        t0 = time.perf_counter()
        pack = await synthesize(ctx.agent_ctx, system=SYSTEM + (f" Focus: {cfg['focus']}" if cfg.get("focus") else ""), used={},
                                title=q, category="brief", angle=cfg.get("focus") or None, region=None, sources=sources,
                                max_facts=int(cfg.get("max_facts", 10)))
        ctx.model_calls += 1
        await ctx.event("model.called", "Evidence pack synthesis", data={"task": "synthesize", "duration_ms": int((time.perf_counter() - t0) * 1000)})
        report = brief_markdown(q, pack)
        ctx.outputs["report"] = report if not ctx.outputs.get("report") else ctx.outputs["report"] + "\n\n---\n\n" + report
        evidence = {k: v for k, v in pack.items() if k not in ("sources", "model_run_id")}
        evidence["sources"] = [{k: v for k, v in s.items() if k not in ("excerpt", "injection_flags")} for s in sources]
        out.append(FlowItem(
            title=q, text="\n\n".join(s["excerpt"] for s in sources)[:20_000], summary=pack.get("summary"),
            url=sources[0]["url"], source_name=sources[0]["publisher"], formats={"article": report},
            data={"evidence": evidence, "warnings": pack.get("warnings") or []},
        ))
    return out
