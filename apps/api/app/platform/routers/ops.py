"""Team members, usage, audit trail, notifications, activity and the live execution-event stream (SSE)."""

from __future__ import annotations

import asyncio
import json
import secrets
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import session_factory
from app.core.deps import Principal, current_principal, get_db, require
from app.core.errors import ApiError, not_found
from app.core.permissions import INSIGHT, LEGACY_ROLE
from app.core.security import hash_password
from app.models import Agent, AuditLog, ExecutionEvent, Membership, Notification, PipelineRun, Tenant, User
from app.platform.events import event_out
from app.platform.plans import check_members, usage
from app.platform.schemas import InviteIn, MemberPatch
from app.platform.serializers import iso, member_out
from app.routers.common import owned

router = APIRouter(tags=["ops"])
HEARTBEAT_S = 15.0
POLL_S = 1.0


# ---------------------------------------------------------------- members
async def ensure_memberships(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    """Users created before memberships existed get one matching their legacy role (self-healing, idempotent)."""
    have = set((await db.execute(select(Membership.user_id).where(Membership.tenant_id == tenant_id))).scalars())
    for u in (await db.execute(select(User).where(User.tenant_id == tenant_id))).scalars():
        if u.id not in have:
            db.add(Membership(user_id=u.id, tenant_id=tenant_id, role=LEGACY_ROLE.get(u.role, "viewer"), status="active"))
    await db.flush()


async def _owners(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    return int((await db.execute(select(func.count()).select_from(Membership).where(
        Membership.tenant_id == tenant_id, Membership.role == "owner"))).scalar_one())


@router.get("/members")
async def list_members(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    await ensure_memberships(db, principal.tenant_id)
    await db.commit()
    rows = (await db.execute(select(Membership, User).join(User, User.id == Membership.user_id)
                             .where(Membership.tenant_id == principal.tenant_id).order_by(Membership.created_at))).all()
    return {"items": [member_out(m, u) for m, u in rows]}


@router.post("/members")
async def invite(body: InviteIn, principal: Principal = Depends(require("members.manage")), db: AsyncSession = Depends(get_db)):
    if body.role == "owner" and principal.role != "owner":
        raise ApiError(403, "permission_denied", "Only an owner can make someone an owner")
    await ensure_memberships(db, principal.tenant_id)
    tenant = await db.get(Tenant, principal.tenant_id)
    await check_members(db, tenant)
    email = body.email.strip().lower()
    user = (await db.execute(select(User).where(func.lower(User.email) == email).order_by(User.created_at).limit(1))).scalar_one_or_none()
    temp_password = None
    if user is not None:
        if (await db.execute(select(Membership.id).where(Membership.user_id == user.id, Membership.tenant_id == tenant.id))).scalar_one_or_none():
            raise ApiError(409, "already_member", f"{email} is already a member of this workspace")
        status = "active"
    else:
        temp_password = secrets.token_urlsafe(12)
        user = User(tenant_id=tenant.id, email=email, name=body.name, password_hash=hash_password(temp_password),
                    role="owner" if body.role == "owner" else "editor")
        db.add(user)
        await db.flush()
        status = "invited"
    m = Membership(user_id=user.id, tenant_id=tenant.id, role=body.role, status=status)
    db.add(m)
    await db.flush()
    audit(db, tenant_id=tenant.id, actor_type="user", actor_id=principal.user.id, action="member.invited", entity="member", entity_id=m.id,
          detail={"email": email, "role": body.role, "new_user": temp_password is not None})
    await db.commit()
    return {"member": member_out(m, user), "temp_password": temp_password}


async def _member(db: AsyncSession, principal: Principal, member_id: str) -> tuple[Membership, User]:
    try:
        mid = uuid.UUID(member_id)
    except ValueError as exc:
        raise not_found("member") from exc
    row = (await db.execute(select(Membership, User).join(User, User.id == Membership.user_id)
                            .where(Membership.id == mid, Membership.tenant_id == principal.tenant_id))).first()
    if row is None:
        raise not_found("member")
    return row[0], row[1]


@router.patch("/members/{member_id}")
async def change_role(member_id: str, body: MemberPatch, principal: Principal = Depends(require("members.manage")),
                      db: AsyncSession = Depends(get_db)):
    m, u = await _member(db, principal, member_id)
    if (m.role == "owner" or body.role == "owner") and principal.role != "owner":
        raise ApiError(403, "permission_denied", "Only an owner can change who is an owner")
    if m.role == "owner" and body.role != "owner" and await _owners(db, m.tenant_id) <= 1:
        raise ApiError(409, "last_owner", "A workspace needs at least one owner")
    old, m.role = m.role, body.role
    audit(db, tenant_id=m.tenant_id, actor_type="user", actor_id=principal.user.id, action="member.role_changed", entity="member",
          entity_id=m.id, detail={"email": u.email, "from": old, "to": body.role})
    await db.commit()
    return member_out(m, u)


@router.delete("/members/{member_id}", status_code=204)
async def remove_member(member_id: str, principal: Principal = Depends(require("members.manage")), db: AsyncSession = Depends(get_db)):
    m, u = await _member(db, principal, member_id)
    if m.role == "owner":
        if principal.role != "owner":
            raise ApiError(403, "permission_denied", "Only an owner can remove an owner")
        if await _owners(db, m.tenant_id) <= 1:
            raise ApiError(409, "last_owner", "The last owner cannot be removed")
    await db.delete(m)
    audit(db, tenant_id=m.tenant_id, actor_type="user", actor_id=principal.user.id, action="member.removed", entity="member",
          entity_id=m.id, detail={"email": u.email, "role": m.role})
    await db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- usage, audit, notifications, activity
@router.get("/usage")
async def get_usage(principal: Principal = Depends(require(INSIGHT)), db: AsyncSession = Depends(get_db)):
    return await usage(db, await db.get(Tenant, principal.tenant_id))


@router.get("/audit")
async def get_audit(limit: int = Query(100, ge=1, le=500), action: str | None = None, principal: Principal = Depends(require(INSIGHT)),
                    db: AsyncSession = Depends(get_db)):
    stmt = select(AuditLog).where(AuditLog.tenant_id == principal.tenant_id)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action.replace('%', '')}%"))
    rows = list((await db.execute(stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit))).scalars())
    user_ids = {uuid.UUID(r.actor_id) for r in rows if r.actor_type == "user" and r.actor_id and len(r.actor_id) == 36}
    emails = dict((await db.execute(select(User.id, User.email).where(User.id.in_(user_ids)))).all()) if user_ids else {}

    def actor(r: AuditLog) -> str:
        if r.actor_type == "user":
            try:
                return emails.get(uuid.UUID(r.actor_id), "user")
            except (TypeError, ValueError):
                return "user"
        if r.actor_type == "api_key":
            return f"api_key:{r.actor_id}"
        return f"agent:{r.actor_id}" if r.actor_type == "agent" else "system"

    return {"items": [{"id": str(r.id), "at": iso(r.created_at), "actor": actor(r), "action": r.action, "entity": r.entity,
                       "entity_id": r.entity_id, "detail": r.detail or {}} for r in rows]}


@router.get("/notifications")
async def notifications(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Notification).where(Notification.tenant_id == principal.tenant_id)
                             .order_by(Notification.created_at.desc()).limit(50))).scalars()
    unread = (await db.execute(select(func.count()).select_from(Notification).where(
        Notification.tenant_id == principal.tenant_id, Notification.read.is_(False)))).scalar_one()
    return {"items": [{"id": str(n.id), "at": iso(n.created_at), "kind": n.kind, "title": n.title, "body": n.body, "link": n.link,
                       "read": n.read} for n in rows], "unread": int(unread)}


@router.post("/notifications/read-all")
async def read_all(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Notification).where(Notification.tenant_id == principal.tenant_id, Notification.read.is_(False)).values(read=True))
    await db.commit()
    return {"ok": True}


@router.get("/activity")
async def activity(limit: int = Query(40, ge=1, le=200), before: str | None = None, category: str | None = None, agent_id: str | None = None,
                   principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    """Unified feed (ActivityItem[]): run milestones + audit events, newest first. Page with ?before=<next_cursor>."""
    from datetime import datetime

    from app.platform.activity import CATEGORIES, feed

    if category and category not in CATEGORIES:
        raise ApiError(422, "invalid_category", f"category must be one of {', '.join(CATEGORIES)}")
    try:
        cursor = datetime.fromisoformat(before.replace(" ", "+")) if before else None  # an unencoded "+" arrives as a space
    except ValueError as exc:
        raise ApiError(422, "invalid_cursor", "before must be a next_cursor value") from exc
    aid = (await owned(db, Agent, agent_id, principal.tenant_id, "agent")).id if agent_id else None
    return await feed(db, principal.tenant_id, limit=limit, before=cursor, category=category, agent_id=aid)


@router.get("/progress")
async def get_progress(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    from app.platform.progress import progress

    return await progress(db, await db.get(Tenant, principal.tenant_id))


# ---------------------------------------------------------------- live events (SSE)
async def stream_events(
    request: Any, tenant_id: uuid.UUID, *, agent_id: uuid.UUID | None, run_id: uuid.UUID | None, after: int | None,
    poll_s: float = POLL_S, heartbeat_s: float = HEARTBEAT_S,
) -> AsyncIterator[str]:
    """Polls execution_events every second (no Redis) and yields SSE frames; a comment heartbeat keeps proxies from
    closing an idle stream. Without a starting id the stream begins at "now"."""
    if after is None:
        async with session_factory()() as db:
            after = int((await db.execute(select(func.max(ExecutionEvent.id)).where(ExecutionEvent.tenant_id == tenant_id))).scalar_one() or 0)
    yield "retry: 3000\n\n"
    last_sent = time.monotonic()
    while True:
        if await request.is_disconnected():
            return
        async with session_factory()() as db:
            stmt = select(ExecutionEvent).where(ExecutionEvent.tenant_id == tenant_id, ExecutionEvent.id > after)
            if agent_id is not None:
                stmt = stmt.where(ExecutionEvent.agent_id == agent_id)
            if run_id is not None:
                stmt = stmt.where(ExecutionEvent.run_id == run_id)
            rows = list((await db.execute(stmt.order_by(ExecutionEvent.id).limit(200))).scalars())
        for e in rows:
            after = e.id
            yield f"id: {e.id}\nevent: {e.type}\ndata: {json.dumps(event_out(e), default=str)}\n\n"
            last_sent = time.monotonic()
        if not rows and time.monotonic() - last_sent >= heartbeat_s:
            yield ": heartbeat\n\n"
            last_sent = time.monotonic()
        await asyncio.sleep(poll_s)


@router.get("/events/stream")
async def events_stream(request: Request, agent_id: str | None = None, run_id: str | None = None, after: int | None = None,
                        principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    aid = (await owned(db, Agent, agent_id, principal.tenant_id, "agent")).id if agent_id else None
    rid = (await owned(db, PipelineRun, run_id, principal.tenant_id, "run")).id if run_id else None
    last = request.headers.get("last-event-id")
    start = int(last) if last and last.isdigit() else after
    await db.close()  # the stream opens its own short sessions; do not hold this one for hours
    return StreamingResponse(stream_events(request, principal.tenant_id, agent_id=aid, run_id=rid, after=start),
                             media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
