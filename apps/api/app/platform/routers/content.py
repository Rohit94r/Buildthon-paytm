"""Content produced by pipelines: review (approve / reject), edit variants, publish to connections."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.deps import (
    Principal,
    current_principal,
    get_db,
    require,
)
from app.core.errors import ApiError
from app.models import ContentItem, Pipeline, PipelineRun
from app.platform.content import make_variant
from app.platform.publishing import default_connections, load_connections
from app.platform.runtime import resume_run
from app.platform.schemas import ContentPatch, PublishIn, RejectIn
from app.platform.serializers import content_out
from app.queue.jobs import enqueue
from app.routers.common import owned

router = APIRouter(prefix="/content", tags=["content"])


async def _name(db: AsyncSession, c: ContentItem) -> str | None:
    if not c.pipeline_id:
        return None
    p = await db.get(Pipeline, c.pipeline_id)
    return p.name if p else None


async def _maybe_resume(db: AsyncSession, c: ContentItem) -> None:
    """A decision on content from a paused run lets that run continue (its publisher step runs again)."""
    if c.run_id:
        run = await db.get(PipelineRun, c.run_id)
        if run is not None and run.status == "awaiting_approval":
            await resume_run(db, run)


@router.get("")
async def list_content(
    status: str | None = None,
    q: str | None = None,
    pipeline_id: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ContentItem).where(ContentItem.tenant_id == principal.tenant_id)
    if status:
        stmt = stmt.where(ContentItem.status.in_(status.split(",")))
    if pipeline_id:
        try:
            stmt = stmt.where(ContentItem.pipeline_id == uuid.UUID(pipeline_id))
        except ValueError:
            return {"items": [], "total": 0}
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(ContentItem.title).like(like), func.lower(ContentItem.summary).like(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = list((await db.execute(stmt.order_by(ContentItem.created_at.desc()).limit(limit).offset(offset))).scalars())
    names = dict((await db.execute(select(Pipeline.id, Pipeline.name).where(Pipeline.tenant_id == principal.tenant_id))).all())
    return {"items": [content_out(c, names.get(c.pipeline_id)) for c in rows], "total": int(total)}


@router.get("/{content_id}")
async def get_content(content_id: str, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    c = await owned(db, ContentItem, content_id, principal.tenant_id, "content")
    return content_out(c, await _name(db, c))


@router.patch("/{content_id}")
async def patch_content(content_id: str, body: ContentPatch, principal: Principal = Depends(require("content.approve")), db: AsyncSession = Depends(get_db)):
    c = await owned(db, ContentItem, content_id, principal.tenant_id, "content")
    if body.title is not None:
        c.title = body.title
    if body.summary is not None:
        c.summary = body.summary
    if body.tags is not None:
        c.tags = [t.strip() for t in body.tags if t.strip()]
    if body.variants is not None:
        c.variants = [make_variant(v.format, v.body, v.title) for v in body.variants]
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="content.edited", entity="content",
          entity_id=c.id, detail={"message": f"Edited '{c.title[:80]}'"})
    await db.commit()
    await db.refresh(c)
    return content_out(c, await _name(db, c))


@router.post("/{content_id}/approve")
async def approve(content_id: str, principal: Principal = Depends(require("content.approve")), db: AsyncSession = Depends(get_db)):
    c = await owned(db, ContentItem, content_id, principal.tenant_id, "content")
    if c.status == "published":
        raise ApiError(409, "already_published", "This content is already published")
    c.status = "approved"
    c.reject_reason = None
    await _maybe_resume(db, c)
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="content.approved", entity="content",
          entity_id=c.id, detail={"message": f"Approved '{c.title[:80]}'"})
    await db.commit()
    await db.refresh(c)
    return content_out(c, await _name(db, c))


@router.post("/{content_id}/reject")
async def reject(content_id: str, body: RejectIn, principal: Principal = Depends(require("content.approve")), db: AsyncSession = Depends(get_db)):
    c = await owned(db, ContentItem, content_id, principal.tenant_id, "content")
    if c.status == "published":
        raise ApiError(409, "already_published", "Published content cannot be rejected")
    c.status = "rejected"
    c.reject_reason = body.reason
    await _maybe_resume(db, c)
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="content.rejected", entity="content",
          entity_id=c.id, detail={"message": f"Rejected '{c.title[:80]}': {body.reason[:200]}"})
    await db.commit()
    await db.refresh(c)
    return content_out(c, await _name(db, c))


@router.post("/{content_id}/publish")
async def publish(content_id: str, body: PublishIn | None = None, principal: Principal = Depends(require("content.approve")), db: AsyncSession = Depends(get_db)):
    c = await owned(db, ContentItem, content_id, principal.tenant_id, "content")
    if c.status == "rejected":
        raise ApiError(409, "rejected", "Rejected content cannot be published; approve it first")
    ids = (body.connection_ids if body and body.connection_ids else None) or await default_connections(db, c)
    conns = await load_connections(db, principal.tenant_id, ids)
    if not conns:
        raise ApiError(422, "no_connections", "No connections to publish to. Add one under Connections.")
    if c.status == "draft":
        c.status = "approved"  # publishing is an explicit human decision
    await enqueue(db, tenant_id=principal.tenant_id, type="content_publish", created_by=principal.user.id, max_attempts=4,
                  payload={"content_id": str(c.id), "connection_ids": [str(x.id) for x in conns]}, dedupe_key=f"content_publish:{c.id}")
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="content.publish_requested", entity="content",
          entity_id=c.id, detail={"message": f"Publishing '{c.title[:80]}' to {len(conns)} connection(s)"})
    await db.commit()
    await db.refresh(c)
    return content_out(c, await _name(db, c))


@router.delete("/{content_id}", status_code=204)
async def delete_content(content_id: str, principal: Principal = Depends(require("content.approve")), db: AsyncSession = Depends(get_db)):
    c = await owned(db, ContentItem, content_id, principal.tenant_id, "content")
    await db.delete(c)
    await db.commit()
    return Response(status_code=204)
