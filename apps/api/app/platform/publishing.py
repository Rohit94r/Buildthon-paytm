"""Publishing content to connections: shared by the auto_publisher step, the `content_publish` job (manual
publish + delivery retries) and the content routes. Each delivery is recorded on the content item."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext
from app.core.audit import audit
from app.core.db import session_factory, utcnow
from app.models import Connection, ContentItem, Notification, Pipeline, Tenant
from app.platform.connections import deliver
from app.platform.events import redact
from app.queue.jobs import BACKOFF_S, RetryableError, enqueue
from app.services.fetcher import Fetcher

DONE = ("published", "manual")


def already_done(content: ContentItem, conn_id: str) -> bool:
    return any(p.get("connection_id") == conn_id and p.get("status") in DONE for p in content.publications or [])


async def publish_to(
    db: AsyncSession, tenant: Tenant, content: ContentItem, conns: list[Connection], fetcher: Fetcher
) -> list[dict[str, Any]]:
    """Deliver to every connection not yet done; update publications, status and connection health. Caller
    commits. Returns the new publication entries (with internal `retryable`)."""
    results = []
    pubs = [dict(p) for p in content.publications or []]
    for conn in conns:
        if already_done(content, str(conn.id)):
            continue
        pub = await deliver(db, tenant, conn, content, fetcher)
        results.append(pub)
        stored = {k: v for k, v in pub.items() if k != "retryable"}
        pubs = [p for p in pubs if p.get("connection_id") != str(conn.id)] + [stored]
        conn.last_used_at = utcnow()
        conn.last_error = pub["error"] if pub["status"] == "failed" else None
        if pub["status"] == "failed" and not pub.get("retryable"):
            # Same transaction as the delivery record (a second writer would block on SQLite).
            db.add(Notification(tenant_id=tenant.id, kind="connection_error", title=f"Publishing to {conn.name} failed",
                                body=redact(pub["error"] or "")[:500], link="/connections"))
        audit(db, tenant_id=tenant.id, actor_type="agent", actor_id="publisher",
              action="publish.failed" if pub["status"] == "failed" else "publish.done", entity="content", entity_id=content.id,
              detail={"connection": conn.name, "kind": conn.kind, "status": pub["status"], "url": pub["url"], "error": pub["error"],
                      "title": content.title})
    content.publications = pubs
    # "manual" means a person still has to post it, so only a real delivery makes the content published.
    if any(p.get("status") == "published" for p in pubs):
        content.status = "published"
        content.published_at = content.published_at or utcnow()
    elif pubs and all(p.get("status") == "failed" for p in pubs):
        content.status = "failed"
    return results


async def default_connections(db: AsyncSession, content: ContentItem) -> list[str]:
    """Connections used when a publish names none: the pipeline's publisher step(s), else every connection."""
    from app.models import Agent

    if content.pipeline_id:
        pipeline = await db.get(Pipeline, content.pipeline_id)
        ids: list[str] = []
        for step in (pipeline.steps if pipeline else []) or []:
            try:
                agent = await db.get(Agent, uuid.UUID(str(step.get("agent_id"))))
            except ValueError:
                continue
            if agent is not None and agent.kind == "auto_publisher":
                ids += [*((agent.config or {}).get("connections") or []), *((step.get("overrides") or {}).get("connections") or [])]
        if ids:
            return list(dict.fromkeys(ids))
    rows = await db.execute(select(Connection.id).where(Connection.tenant_id == content.tenant_id))
    return [str(r) for r in rows.scalars()]


async def load_connections(db: AsyncSession, tenant_id: uuid.UUID, ids: list[str]) -> list[Connection]:
    wanted = []
    for i in ids:
        try:
            wanted.append(uuid.UUID(str(i)))
        except ValueError:
            continue
    if not wanted:
        return []
    rows = (await db.execute(select(Connection).where(Connection.tenant_id == tenant_id, Connection.id.in_(wanted)))).scalars()
    by_id = {c.id: c for c in rows}
    return [by_id[i] for i in wanted if i in by_id]


async def schedule_retry(db: AsyncSession, content: ContentItem, conn_ids: list[str], *, offset: int = 1) -> None:
    """Queue a delivery retry for connections that failed with a transient error. Caller commits."""
    await enqueue(
        db, tenant_id=content.tenant_id, type="content_publish",
        payload={"content_id": str(content.id), "connection_ids": conn_ids, "retry_offset": offset},
        available_at=utcnow() + timedelta(seconds=BACKOFF_S[0]), max_attempts=len(BACKOFF_S) - offset + 1,
        dedupe_key=f"content_publish:{content.id}",
    )


async def run_content_publish(
    ctx: AgentContext, content_id: uuid.UUID, connection_ids: list[str] | None, *, job_attempts: int, max_attempts: int,
    retry_offset: int = 0,
) -> dict[str, Any]:
    """Worker handler for `content_publish`. Transient failures raise RetryableError so the queue retries
    with backoff (30s, 2m, 10m); connections that already succeeded are skipped on retry."""
    async with session_factory()() as db:
        content = await db.get(ContentItem, content_id)
        tenant = await db.get(Tenant, ctx.tenant.id)
        if content is None or content.tenant_id != ctx.tenant.id:
            return {"skipped": "content deleted"}
        ids = connection_ids or await default_connections(db, content)
        conns = await load_connections(db, content.tenant_id, ids)
        results = await publish_to(db, tenant, content, conns, ctx.fetcher)
        await db.commit()
    retry = [r["connection_id"] for r in results if r["status"] == "failed" and r.get("retryable")]
    if retry and job_attempts < max_attempts:
        delay = BACKOFF_S[min(job_attempts - 1 + retry_offset, len(BACKOFF_S) - 1)]
        raise RetryableError(f"{len(retry)} delivery(ies) failed temporarily; retrying", retry_after_s=delay)
    return {
        "published": sum(1 for r in results if r["status"] == "published"),
        "manual": sum(1 for r in results if r["status"] == "manual"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
    }
