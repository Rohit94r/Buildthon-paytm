"""Execution events and notifications. Events are written as work really happens (run/step lifecycle, every
tool call, every model call) in short transactions so the SSE stream sees them immediately. Everything is
redacted first: secrets must never reach a customer-visible log."""

from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import select

from app.core.db import session_factory
from app.models import ExecutionEvent, Notification

SECRET_KEYS = re.compile(r"(secret|token|password|passwd|authorization|api[_-]?key|auth_value|bot_token|cookie)", re.I)
SECRET_VALUES = [
    (re.compile(r"lf_pk_[A-Za-z0-9]{8,}"), "lf_pk_***"),
    (re.compile(r"(?i)\b(bearer|ghost|basic)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 ***"),
    (re.compile(r"(?i)((?:^|[?&\s])(?:token|key|secret|password|api_key|access_token)=)[^&\s]+"), r"\1***"),
    (re.compile(r"(api\.telegram\.org/bot)[^/\s]+"), r"\1***"),
    (re.compile(r"(hooks\.slack\.com/services/)[^\s\"']+"), r"\1***"),
    (re.compile(r"(discord(?:app)?\.com/api/webhooks/\d+/)[^\s\"']+"), r"\1***"),
]
MAX_STR = 2000


def redact(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return "…"
    if isinstance(value, str):
        out = value
        for pat, rep in SECRET_VALUES:
            out = pat.sub(rep, out)
        return out[:MAX_STR]
    if isinstance(value, dict):
        return {k: ("***" if SECRET_KEYS.search(str(k)) and v not in (None, "") else redact(v, depth + 1)) for k, v in list(value.items())[:50]}
    if isinstance(value, list | tuple):
        return [redact(v, depth + 1) for v in list(value)[:50]]
    if isinstance(value, int | float | bool) or value is None:
        return value
    return redact(str(value), depth + 1)


async def emit(
    tenant_id: uuid.UUID,
    type: str,
    message: str,
    *,
    run_id: uuid.UUID | None = None,
    step_id: str | None = None,
    agent_id: str | uuid.UUID | None = None,
    agent_name: str | None = None,
    level: str = "info",
    data: dict[str, Any] | None = None,
) -> int:
    aid = uuid.UUID(str(agent_id)) if agent_id and len(str(agent_id)) >= 32 else None
    async with session_factory()() as db:
        row = ExecutionEvent(tenant_id=tenant_id, run_id=run_id, step_id=step_id, agent_id=aid, agent_name=agent_name, type=type,
                             level=level, message=redact(message)[:MAX_STR], data=redact(data or {}))
        db.add(row)
        await db.commit()
        return row.id


async def notify(tenant_id: uuid.UUID, kind: str, title: str, body: str = "", link: str | None = None, *, dedupe: bool = True) -> None:
    """Workspace notification. `dedupe` skips an identical unread one, so a failing schedule cannot flood the bell."""
    async with session_factory()() as db:
        if dedupe:
            same = (await db.execute(select(Notification.id).where(
                Notification.tenant_id == tenant_id, Notification.kind == kind, Notification.title == title,
                Notification.read.is_(False)).limit(1))).scalar_one_or_none()
            if same is not None:
                return
        db.add(Notification(tenant_id=tenant_id, kind=kind, title=redact(title)[:300], body=redact(body)[:1000], link=link))
        await db.commit()


def event_out(e: ExecutionEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "at": e.created_at.isoformat(),
        "run_id": str(e.run_id) if e.run_id else None,
        "step_id": e.step_id,
        "agent_id": str(e.agent_id) if e.agent_id else None,
        "agent_name": e.agent_name,
        "type": e.type,
        "level": e.level,
        "message": e.message,
        "data": e.data or {},
    }
