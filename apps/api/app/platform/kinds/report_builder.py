"""report_builder: summarise the items of a run into a markdown report (deterministic item list + optional model
executive summary grounded in those items) and save it as a content item in the "article" format."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.core.db import utcnow
from app.platform.content import sync_content
from app.platform.flow import FlowItem
from app.services.text import truncate_words


class Summary(BaseModel):
    summary: str = Field(min_length=20, max_length=1500)
    highlights: list[str] = Field(default_factory=list, max_length=6)


def item_lines(items: list[FlowItem], include_links: bool) -> list[str]:
    lines = []
    for it in items:
        head = f"[{it.title}]({it.url})" if include_links and it.url else f"**{it.title}**"
        detail = truncate_words(it.summary or it.text or "", 240, ellipsis=True)
        extra = ", ".join(f"{k}: {v}" for k, v in it.data.items() if isinstance(v, str | int | float) and not isinstance(v, bool) and k not in ("source_title",))[:200]
        lines.append(f"- {head}" + (f" — {detail}" if detail else "") + (f" ({extra})" if extra else ""))
    return lines


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    date = utcnow().date().isoformat()
    title = (cfg.get("title") or "Report {{date}}").replace("{{date}}", date)
    body = [f"# {title}", "", f"{len(items)} item(s) · generated {date}", ""]
    if cfg.get("use_model", True) and items:
        listing = "\n".join(f"- {it.title}: {truncate_words(it.summary or it.text or '', 400)}" for it in items[:30])
        out = await ctx.generate(
            task="report_summary", schema=Summary, temperature=0.2, max_tokens=700,
            system="You write concise executive summaries using only the items given. No outside facts.",
            prompt=f"Write an executive summary (3–5 sentences) and up to 5 highlights of these items.\n{cfg.get('instructions') or ''}\n\nITEMS\n{listing}",
            context={"items": [{"title": it.title, "text": it.summary or it.text} for it in items[:30]]},
        )
        body += ["## Summary", "", out.summary.strip(), ""]
        if out.highlights:
            body += ["## Highlights", ""] + [f"- {h}" for h in out.highlights] + [""]
    body += ["## Items", ""] + (item_lines(items, cfg.get("include_links", True)) or ["No items in this run."])
    report = "\n".join(body).strip()
    ctx.outputs["report"] = report
    images = [img for it in items for img in (it.data.get("images") or [])][:8]
    report_item = FlowItem(title=title, text=report, summary=f"{len(items)} item(s) summarised", formats={"article": report},
                           image_url=next((it.image_url for it in items if it.image_url), None),
                           data={"items": len(items), "tags": ["report"], **({"images": images} if images else {})})
    await sync_content(ctx, report_item)
    await ctx.log(f"Report '{title}' built from {len(items)} item(s)")
    return [report_item]
