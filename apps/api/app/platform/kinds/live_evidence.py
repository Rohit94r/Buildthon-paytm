"""Shared sponsor-evidence helpers for ordinary agent kinds.

LiveDesk's two sponsor APIs are platform capabilities, not two isolated widgets: any agent can opt in with
``live_sources: true`` in its config. Every call goes through the tool registry, so runs get tool events, tool
allowlists are respected, and offline runs degrade to labelled sample data instead of crashing the run.
"""

from __future__ import annotations

from typing import Any

from app.platform.tools import invoke


async def live_hits(
    ctx,
    query: str,
    *,
    provider: str = "serpapi",
    engine: str = "google",
    count: int = 5,
    location: str = "",
) -> list[dict[str, Any]]:
    """Live search hits from SerpApi (default) or You.com, normalised to plain dicts."""
    key = "you.search" if provider == "you" else "serpapi.search"
    args: dict[str, Any] = {"query": query, "count": max(1, min(int(count), 20))}
    if key == "serpapi.search":
        args.update(engine=engine, location=location)
    hits = await invoke(ctx, key, summary=lambda r: {"results": len(r)}, **args)
    return [h for h in hits if isinstance(h, dict) and h.get("url")]


def hit_candidate(hit: dict[str, Any]) -> dict[str, Any]:
    """Turn a sponsor hit into the candidate shape used by the researcher's source pipeline."""
    return {
        "url": hit["url"],
        "title": hit.get("title"),
        "publisher": hit.get("source") or hit.get("provider"),
        "snippet": hit.get("summary") or "",
    }


async def cited_answer(ctx, query: str, *, country: str = "IN", language: str = "EN") -> dict[str, Any]:
    """A You.com answer with numbered citations, for agents that want a cited narrative."""
    return await invoke(
        ctx, "you.answer",
        summary=lambda a: {"citations": len(a.get("citations") or [])},
        query=query, country=country, language=language,
    )


def cited_answer_markdown(query: str, answer: dict[str, Any]) -> str:
    lines = [f"## Live cited answer: {query}", "", str(answer.get("answer") or ""), "", "### Sources", ""]
    for c in answer.get("citations") or []:
        if not isinstance(c, dict):
            continue
        lines.append(f"[{c.get('number', '?')}] [{c.get('title') or c.get('source')}]({c.get('source')})")
    if (answer.get("provider") or "") == "demo" or answer.get("degraded"):
        lines += ["", "> Sample data: sponsor keys are not configured."]
    return "\n".join(lines).strip()
