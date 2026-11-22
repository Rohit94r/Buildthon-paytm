"""Numbers for the operator overview and workspace dashboards. Grouped queries (one per metric across all
workspaces) instead of per-workspace loops; every figure comes from real rows."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.models import Agent, AuditLog, ContentItem, DatasetRecord, Pipeline, PipelineRun, Tenant

ACTIVITY_PREFIXES = ("run.", "content.", "publish.", "dataset.", "agent.", "connection.", "pipeline.", "workspace.", "blueprint.")


async def workspace_stats(db: AsyncSession, tenant_ids: list[uuid.UUID] | None = None) -> dict[uuid.UUID, dict[str, int]]:
    now = utcnow()
    day, week = now - timedelta(hours=24), now - timedelta(days=7)
    out: dict[uuid.UUID, dict[str, int]] = defaultdict(dict)

    async def grouped(key: str, stmt) -> None:
        if tenant_ids is not None:
            stmt = stmt.where(stmt.selected_columns[0].in_(tenant_ids))
        for tid, n in (await db.execute(stmt)).all():
            out[tid][key] = int(n)

    await grouped("agents", select(Agent.tenant_id, func.count()).group_by(Agent.tenant_id))
    await grouped("pipelines", select(Pipeline.tenant_id, func.count()).group_by(Pipeline.tenant_id))
    await grouped("runs_24h", select(PipelineRun.tenant_id, func.count()).where(PipelineRun.created_at >= day).group_by(PipelineRun.tenant_id))
    await grouped("failed_24h", select(PipelineRun.tenant_id, func.count())
                  .where(PipelineRun.created_at >= day, PipelineRun.status == "failed").group_by(PipelineRun.tenant_id))
    await grouped("content_7d", select(ContentItem.tenant_id, func.count()).where(ContentItem.created_at >= week).group_by(ContentItem.tenant_id))
    await grouped("published_7d", select(ContentItem.tenant_id, func.count())
                  .where(ContentItem.published_at >= week, ContentItem.status == "published").group_by(ContentItem.tenant_id))
    await grouped("records", select(DatasetRecord.tenant_id, func.count()).group_by(DatasetRecord.tenant_id))
    return out


async def runs_by_day(db: AsyncSession, tenant_id: uuid.UUID | None = None, days: int = 14) -> list[dict[str, Any]]:
    start = (utcnow() - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    stmt = select(PipelineRun.created_at, PipelineRun.status).where(PipelineRun.created_at >= start)
    if tenant_id is not None:
        stmt = stmt.where(PipelineRun.tenant_id == tenant_id)
    buckets = {(start + timedelta(days=i)).date().isoformat(): {"succeeded": 0, "failed": 0} for i in range(days)}
    for created, status in (await db.execute(stmt)).all():
        key = created.date().isoformat()
        if key in buckets and status in ("succeeded", "failed"):
            buckets[key][status] += 1
    return [{"day": d, **v} for d, v in buckets.items()]


def _kind(action: str, error: bool) -> str:
    if error:
        return "error"
    head = action.split(".", 1)[0]
    return {"run": "run", "content": "content", "publish": "publish", "dataset": "dataset", "agent": "agent",
            "connection": "connection", "pipeline": "run", "blueprint": "agent", "workspace": "agent"}.get(head, "agent")


def _status(action: str, detail: dict[str, Any]) -> str:
    if detail.get("error") or action.endswith((".failed", ".error")):
        return "error"
    if action.endswith(("awaiting_approval", ".rejected", ".manual")):
        return "warn"
    if action.endswith((".succeeded", ".done", ".approved", ".published", ".imported")):
        return "ok"
    return "info"


def _message(a: AuditLog) -> str:
    d = a.detail or {}
    if d.get("message") and d.get("pipeline"):
        return f"{d['pipeline']}: {d['message']}"
    if a.action.startswith("publish."):
        base = f"'{(d.get('title') or 'Content')[:60]}' → {d.get('connection', '?')}"
        return base + (f" failed: {d['error']}" if d.get("error") else f" ({d.get('status')})")
    return d.get("message") or d.get("name") or a.action.replace(".", " ")


async def activity(db: AsyncSession, tenant_id: uuid.UUID | None = None, limit: int = 30) -> list[dict[str, Any]]:
    from sqlalchemy import or_

    stmt = select(AuditLog).where(or_(*[AuditLog.action.like(f"{p}%") for p in ACTIVITY_PREFIXES]))
    if tenant_id is not None:
        stmt = stmt.where(AuditLog.tenant_id == tenant_id)
    rows = list((await db.execute(stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit))).scalars())
    tenants = {t.id: t for t in (await db.execute(select(Tenant).where(Tenant.id.in_({r.tenant_id for r in rows})))).scalars()} if rows else {}
    out = []
    for a in rows:
        d = a.detail or {}
        status = _status(a.action, d)
        t = tenants.get(a.tenant_id)
        out.append({
            "id": str(a.id),
            "at": a.created_at.isoformat(),
            "workspace": t.slug if t else "",
            "workspace_name": t.name if t else "",
            "kind": _kind(a.action, status == "error"),
            "message": _message(a)[:300],
            "status": status,
        })
    return out


async def agent_stats(db: AsyncSession, tenant_id: uuid.UUID, days: int = 30) -> dict[str, dict[str, Any]]:
    """Per-agent run stats from the step records of recent runs."""
    since = utcnow() - timedelta(days=days)
    rows = (await db.execute(
        select(PipelineRun.steps).where(PipelineRun.tenant_id == tenant_id, PipelineRun.created_at >= since)
        .order_by(PipelineRun.created_at.desc()).limit(500)
    )).scalars()
    acc: dict[str, dict[str, Any]] = defaultdict(lambda: {"runs": 0, "ok": 0, "done": 0, "ms": [], "last": None})
    for steps in rows:
        for s in steps or []:
            if s.get("status") not in ("succeeded", "failed"):
                continue
            a = acc[s.get("agent_id")]
            a["runs"] += 1
            a["done"] += 1
            a["ok"] += s["status"] == "succeeded"
            if s.get("duration_ms") is not None:
                a["ms"].append(s["duration_ms"])
            if s.get("finished_at") and (a["last"] is None or s["finished_at"] > a["last"]):
                a["last"] = s["finished_at"]
    return {
        k: {"runs": v["runs"], "last_run_at": v["last"], "success_rate": round(v["ok"] / v["done"], 3) if v["done"] else None,
            "avg_ms": int(sum(v["ms"]) / len(v["ms"])) if v["ms"] else None}
        for k, v in acc.items()
    }
