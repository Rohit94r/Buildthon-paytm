"""auto_publisher: deliver content items to the selected connections. With `require_approval` on the pipeline,
items whose content is still `draft` pause the run (`awaiting_approval`); approving them in Content resumes
the run here and only the not-yet-published items are delivered. Transient delivery failures are retried by
a `content_publish` job (30s, 2m, 10m)."""

from __future__ import annotations

import uuid
from typing import Any

from app.core.db import session_factory
from app.models import ContentItem
from app.platform.content import sync_content
from app.platform.flow import FlowItem
from app.platform.publishing import load_connections
from app.platform.runtime import AwaitingApproval
from app.platform.tools import invoke


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    conn_ids: list[str] = cfg.get("connections") or []
    if not ctx.persist:
        await ctx.log(f"Dry run: would publish {len(items)} item(s) to {len(conn_ids)} connection(s)")
        return items
    for item in items:
        if not item.content_id:
            await sync_content(ctx, item)

    async with session_factory()() as db:
        conns = await load_connections(db, ctx.tenant.id, conn_ids)
        if len(conns) < len(conn_ids):
            await ctx.log(f"{len(conn_ids) - len(conns)} selected connection(s) no longer exist", "warn")
        if not conns:
            await ctx.log("No connections selected: content is kept in Content, ready to publish manually", "warn")

        out: list[FlowItem] = []
        pending = published = failed = manual = 0
        for item in items:
            await ctx.check_cancel()
            content = await db.get(ContentItem, uuid.UUID(item.content_id)) if item.content_id else None
            if content is None or content.status == "rejected":
                continue
            if content.status == "draft" and ctx.require_approval:
                pending += 1
                out.append(item)
                continue
            if conns:
                results = await invoke(ctx, "publish.connection", summary=lambda r: {"deliveries": len(r)},
                                       content_id=str(content.id), connection_ids=[str(c.id) for c in conns])
                for r in results:
                    if r["status"] == "published":
                        published += 1
                        await ctx.log(f"Published '{content.title[:60]}' to {r['connection_name']}" + (f": {r['url']}" if r["url"] else ""))
                    elif r["status"] == "manual":
                        manual += 1
                        await ctx.log(f"'{content.title[:60]}' prepared for manual posting on {r['connection_name']}")
                    else:
                        failed += 1
                        await ctx.log(f"'{content.title[:60]}' → {r['connection_name']} failed: {r['error']}", "error" if not r.get("retryable") else "warn")
                retry = [r for r in results if r["status"] == "failed" and r.get("retryable")]
                if retry:
                    await ctx.log(f"Retrying {len(retry)} delivery(ies) for '{content.title[:60]}' in the background")
            out.append(item)
        await db.commit()

    await ctx.log(f"Publisher: {published} published, {manual} manual, {failed} failed" + (f", {pending} awaiting approval" if pending else ""))
    if pending:
        raise AwaitingApproval(pending)
    return out
