"""Unified activity feed: run/step milestones from execution events (one entry per milestone, never per log line)
merged with audit events (agents, content, publishing, data, connections, team, plan), as plain-English titles
with metrics and the points each earned (same rules as /progress)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, ExecutionEvent, User
from app.platform.progress import ITEMS_PER_RUN_CAP, XP

EVENT_TYPES = ("run.finished", "run.failed", "run.awaiting_approval", "run.cancelled", "step.finished", "step.failed", "tool.result")
AUDIT_PREFIXES = ("agent.", "content.", "publish.", "dataset.", "connection.", "member.", "workspace.", "package.", "blueprint.", "run.approved",
                  "run.rejected", "pipeline.created")
CATEGORIES = ("run", "agent", "content", "publish", "data", "connection", "team", "system")


def _pts(key: str, n: int = 1) -> int:
    return XP[key][1] * n


def from_event(e: ExecutionEvent) -> dict[str, Any] | None:
    d = e.data or {}
    who = e.agent_name
    base = {"id": f"e{e.id}", "at": e.created_at.isoformat(), "actor": who, "agent_id": str(e.agent_id) if e.agent_id else None,
            "run_id": str(e.run_id) if e.run_id else None, "link": f"/runs/{e.run_id}" if e.run_id else None, "detail": None, "xp": 0, "metrics": {}}
    if e.type == "step.finished":
        n_in, n_out = int(d.get("items_in") or 0), int(d.get("items_out") or 0)
        title = (f"{who} kept {n_out} of {n_in} items" if n_out < n_in else
                 f"{who} produced {n_out} item{'s' if n_out != 1 else ''}" if n_in == 0 else f"{who} processed {n_out} item{'s' if n_out != 1 else ''}")
        return {**base, "category": "run", "type": "step.finished", "level": "info", "title": title,
                "metrics": {"items": n_out, "items_in": n_in, **({"removed": n_in - n_out} if n_out < n_in else {}),
                            **({"duration_ms": int(d["duration_ms"])} if d.get("duration_ms") else {})}}
    if e.type == "step.failed":
        return {**base, "category": "run", "type": "step.failed", "level": "error", "title": f"{who} hit a problem", "detail": e.message}
    if e.type == "run.finished":
        items, content = int(d.get("items_out") or 0), int(d.get("content_created") or 0)
        name = e.message.split(":")[0]
        return {**base, "category": "run", "type": "run.finished", "level": "success",
                "title": f"{name} finished with {items} item{'s' if items != 1 else ''}" + (f" and {content} new content" if content else ""),
                "xp": _pts("run_succeeded") + _pts("item_processed", min(items, ITEMS_PER_RUN_CAP)), "metrics": {"items": items, "content": content}}
    if e.type == "run.failed":
        return {**base, "category": "run", "type": "run.failed", "level": "error", "title": e.message.split(":")[0] + " failed", "detail": e.message}
    if e.type == "run.awaiting_approval":
        return {**base, "category": "run", "type": "run.awaiting_approval", "level": "warn", "title": "Waiting for your approval", "detail": e.message}
    if e.type == "run.cancelled":
        return {**base, "category": "run", "type": "run.cancelled", "level": "warn", "title": "Run stopped", "detail": e.message}
    if e.type == "tool.result" and d.get("tool") == "dataset.upsert" and d.get("ok"):
        created, updated = int(d.get("created") or 0), int(d.get("updated") or 0)
        if not created and not updated:
            return None
        return {**base, "category": "data", "type": "records.saved", "level": "success",
                "title": f"{who} saved {created + updated} record{'s' if created + updated != 1 else ''}" + (f" ({created} new)" if created else ""),
                "xp": _pts("record_saved", created), "metrics": {"created": created, "updated": updated}}
    return None


def from_audit(a: AuditLog, actor: str | None) -> dict[str, Any] | None:
    d = a.detail or {}
    act = a.action
    msg = d.get("message")
    base = {"id": f"a{a.id}", "at": a.created_at.isoformat(), "actor": actor, "agent_id": None, "run_id": None, "link": None, "detail": None,
            "xp": 0, "metrics": {}, "type": act}
    if act in ("agent.activated", "agent.created"):
        return {**base, "category": "agent", "level": "success", "title": msg or "Agent activated", "xp": _pts("agent_activated"),
                "agent_id": a.entity_id, "link": f"/agents/{a.entity_id}"}
    if act.startswith("agent."):
        return {**base, "category": "agent", "level": "info", "title": msg or act.replace(".", " "), "agent_id": a.entity_id, "link": f"/agents/{a.entity_id}"}
    if act in ("content.approved", "content.rejected", "run.approved", "run.rejected"):
        return {**base, "category": "content", "level": "success" if act.endswith("approved") else "warn", "title": msg or act.replace(".", " "),
                "xp": _pts("approval_handled"), "link": f"/content/{a.entity_id}" if act.startswith("content.") else f"/runs/{a.entity_id}"}
    if act.startswith("content."):
        return {**base, "category": "content", "level": "info", "title": msg or act.replace(".", " "), "link": f"/content/{a.entity_id}"}
    if act == "publish.done":
        manual = d.get("status") == "manual"
        return {**base, "type": "content.published", "category": "publish", "level": "success",
                "title": f"{'Prepared' if manual else 'Published'} '{(d.get('title') or 'content')[:60]}' {'for' if manual else 'to'} {d.get('connection')}",
                "detail": d.get("url"), "xp": 0 if manual else _pts("content_published"), "link": f"/content/{a.entity_id}"}
    if act == "publish.failed":
        return {**base, "category": "publish", "level": "error", "title": f"Publishing to {d.get('connection')} failed", "detail": d.get("error"),
                "link": f"/content/{a.entity_id}"}
    if act.startswith("dataset."):
        return {**base, "category": "data", "level": "success", "title": msg or act.replace(".", " ")}
    if act == "connection.tested":
        return {**base, "category": "connection", "level": "success", "title": msg or "Connection works", "xp": _pts("connection_working"),
                "link": "/connections"}
    if act == "connection.test_failed":
        return {**base, "category": "connection", "level": "error", "title": msg or "Connection test failed", "link": "/connections"}
    if act.startswith("connection."):
        return {**base, "category": "connection", "level": "info", "title": msg or act.replace(".", " "), "link": "/connections"}
    if act.startswith("member."):
        who = d.get("email") or "a teammate"
        title = {"member.invited": f"Invited {who} as {d.get('role')}", "member.role_changed": f"{who} is now {d.get('to')}",
                 "member.removed": f"Removed {who}"}.get(act, act)
        return {**base, "category": "team", "level": "info", "title": title, "link": "/settings/team"}
    if act == "workspace.updated" and ("plan" in d or "status" in d):
        title = f"Plan changed to {d['plan']}" if "plan" in d else f"Workspace {d.get('status')}"
        return {**base, "category": "system", "level": "info", "title": title}
    if act.startswith(("package.", "blueprint.", "workspace.", "pipeline.")):
        return {**base, "category": "system", "level": "info", "title": msg or act.replace(".", " ")}
    return None


async def feed(db: AsyncSession, tenant_id: uuid.UUID, *, limit: int = 40, before: datetime | None = None, category: str | None = None,
               agent_id: uuid.UUID | None = None) -> dict[str, Any]:
    scan = limit * 4
    ev = select(ExecutionEvent).where(ExecutionEvent.tenant_id == tenant_id, ExecutionEvent.type.in_(EVENT_TYPES))
    au = select(AuditLog).where(AuditLog.tenant_id == tenant_id, or_(*[AuditLog.action.like(f"{p}%") for p in AUDIT_PREFIXES]))
    if before is not None:
        ev, au = ev.where(ExecutionEvent.created_at < before), au.where(AuditLog.created_at < before)
    if agent_id is not None:
        ev = ev.where(ExecutionEvent.agent_id == agent_id)
        au = au.where(AuditLog.entity_id == str(agent_id))
    events = list((await db.execute(ev.order_by(ExecutionEvent.created_at.desc(), ExecutionEvent.id.desc()).limit(scan))).scalars())
    audits = list((await db.execute(au.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(scan))).scalars())
    user_ids = set()
    for a in audits:
        if a.actor_type == "user" and a.actor_id:
            try:
                user_ids.add(uuid.UUID(a.actor_id))
            except ValueError:
                pass
    names = dict((await db.execute(select(User.id, User.email).where(User.id.in_(user_ids)))).all()) if user_ids else {}

    def actor(a: AuditLog) -> str | None:
        if a.actor_type == "user":
            try:
                return names.get(uuid.UUID(a.actor_id or ""))
            except ValueError:
                return None
        return a.actor_id if a.actor_type in ("agent", "api_key") else "system"

    items = [x for x in [from_event(e) for e in events] if x] + [x for x in [from_audit(a, actor(a)) for a in audits] if x]
    if category:
        items = [i for i in items if i["category"] == category]
    items.sort(key=lambda i: i["at"], reverse=True)
    page = items[:limit]
    more = len(items) > limit or len(events) == scan or len(audits) == scan
    return {"items": page, "next_cursor": page[-1]["at"] if page and more else None}
