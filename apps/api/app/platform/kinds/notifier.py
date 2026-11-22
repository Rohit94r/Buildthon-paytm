"""notifier: send a message per item, or one digest for all items, to Telegram, Slack, Discord, email (SMTP) or a
webhook. Templates use the same {{placeholders}} as custom AI steps."""

from __future__ import annotations

from typing import Any

from app.platform.flow import FlowItem
from app.platform.kinds.custom_llm import render_template
from app.platform.tools import invoke


def digest(items: list[FlowItem], template: str, title: str) -> str:
    lines = [title, ""] if title else []
    for i, it in enumerate(items, 1):
        lines.append(f"{i}. " + render_template(template, it).strip().replace("\n", " — "))
    return "\n".join(lines).strip()


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    conn_ids = cfg.get("connections") or []
    if not conn_ids:
        raise ValueError("Pick at least one connection to notify")
    if not items and cfg.get("skip_when_empty", True):
        await ctx.log("Nothing to send")
        return items
    template = cfg.get("template") or "{{title}}\n{{url}}"
    subject = cfg.get("title") or f"{ctx.workspace_name}: update"
    if cfg.get("mode") == "per_item":
        messages = [(render_template(template, it), it.title) for it in items]
    else:
        messages = [(digest(items, template, subject), subject)]
    sent = 0
    for conn_id in conn_ids:
        for text, subj in messages:
            await invoke(ctx, "notify.send", summary=lambda r: {"ok": r.get("ok", False)}, connection_id=conn_id, text=text, subject=subj)
            sent += 1
    await ctx.log(f"Sent {sent} message(s) to {len(conn_ids)} connection(s)" + (" (dry run)" if not ctx.persist else ""))
    return items
