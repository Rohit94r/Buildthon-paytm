"""You.com cited researcher: answers a question with live web evidence and numbered citations.

Track 2 integration. ``answer`` mode uses the You.com Answer API (which returns an answer plus verbatim
citations); ``search`` mode builds a cited brief from Web Search results. Both paths put the answer in an item's
article format and the structured citations in ``data['citations']`` so the assistant UI can render them.
"""

from __future__ import annotations

from typing import Any

from app.platform.flow import FlowItem
from app.platform.tools import invoke


def _host(url: str) -> str:
    try:
        return url.split("://", 1)[-1].split("/", 1)[0]
    except Exception:
        return url


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    question = str(cfg.get("question") or "").strip()
    questions = [question] if question else [it.title for it in items if it.title][: int(cfg.get("max_questions", 5))]
    if not questions:
        raise ValueError("Add a question (or pass items whose titles are questions)")

    mode = cfg.get("mode", "answer")
    country, language = cfg.get("country", "IN"), cfg.get("language", "EN")
    count = int(cfg.get("count", 5))
    freshness = str(cfg.get("freshness") or "")
    out: list[FlowItem] = []
    failed = 0

    for q in questions:
        await ctx.check_cancel()
        try:
            if mode == "answer":
                result = await invoke(
                    ctx, "you.answer", summary=lambda r: {"citations": len(r.get("citations") or [])},
                    query=q, country=country, language=language,
                )
                answer = str(result.get("answer") or "")
                citations = list(result.get("citations") or [])
                evidence = result.get("results") or []
                provider = result.get("provider", "you.com")
                degraded = bool(result.get("degraded"))
            else:
                hits = await invoke(
                    ctx, "you.search", summary=lambda r: {"results": len(r)},
                    query=q, count=count, freshness=freshness,
                )
                citations = [
                    {"number": i + 1, "source": h.get("url", ""), "title": h.get("title") or _host(h.get("url", "")),
                     "excerpt": h.get("summary", "")[:400], "provider": h.get("provider", "you.com")}
                    for i, h in enumerate(hits[:count])
                ]
                lines = [f"{i + 1}. **{h.get('title')}** — {h.get('summary', '')[:300]} [link]({h.get('url')})"
                         for i, h in enumerate(hits[:count])]
                answer = f"Live web findings for {q}:\n\n" + "\n".join(lines)
                evidence = hits
                provider = "you.com"
                degraded = all(h.get("provider") == "demo" for h in hits)
        except Exception as exc:
            failed += 1
            await ctx.log(f"You.com research failed for '{q[:80]}': {exc}", "warn")
            answer, citations, evidence, provider, degraded = "", [], [], "you.com", True

        citation_block = "\n\n".join(
            f"[{c.get('number', i + 1)}] {c.get('title') or _host(c.get('source', ''))} — {c.get('source', '')}"
            + (f"\n    {c.get('excerpt', '')[:400]}" if c.get("excerpt") else "")
            for i, c in enumerate(citations)
        )
        article = (answer + "\n\n---\n\n## Sources\n" + citation_block).strip()
        flags: list[str] = []
        if degraded:
            flags.append("sample_sources")
        if not answer:
            flags.append("no_answer")
        out.append(FlowItem(
            title=q, text=answer[:20000], summary=answer[:500],
            formats={"article": article},
            url=(citations[0].get("source") if citations else None),
            source_name="You.com",
            data={
                "answer": answer, "citations": citations,
                "question": q, "provider": provider, "degraded": degraded,
                "evidence_count": len(evidence), "mode": mode,
            },
            flags=flags,
        ))
        ctx.outputs["report"] = article if not ctx.outputs.get("report") else ctx.outputs["report"] + "\n\n---\n\n" + article

    if failed and failed >= len(questions):
        await ctx.log("Every You.com question failed; items are flagged for review", "warn")
    await ctx.log(f"You.com {mode}: {len(out)} answer(s), {sum(len(i.data.get('citations') or []) for i in out)} citation(s)")
    return out
