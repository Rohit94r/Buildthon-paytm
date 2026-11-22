"""Plans, quotas and usage counters. Limits are configured in code (no payment provider: a platform admin
changes a workspace's plan). Quotas are checked when work is created or queued; concurrency is enforced when
a run starts (extra runs wait in the queue, so one busy workspace cannot starve the others)."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_factory, utcnow
from app.core.errors import ApiError
from app.models import Agent, DatasetRecord, Membership, PipelineRun, Tenant, UsageCounter

UNLIMITED = -1
PLANS: dict[str, dict[str, Any]] = {
    "free": {"name": "Free", "price_inr_month": 0, "description": "Try LayerFlow with a few agents.",
             "limits": {"agents": 5, "runs_per_day": 50, "concurrent_runs": 1, "records": 1_000, "api_calls_per_day": 500,
                        "members": 3, "premium_agents": False}},
    "starter": {"name": "Starter", "price_inr_month": 1_999, "description": "A small team automating one website.",
                "limits": {"agents": 15, "runs_per_day": 300, "concurrent_runs": 2, "records": 10_000, "api_calls_per_day": 5_000,
                           "members": 5, "premium_agents": False}},
    "pro": {"name": "Pro", "price_inr_month": 4_999, "description": "Premium agents, more runs and data.",
            "limits": {"agents": 40, "runs_per_day": 1_500, "concurrent_runs": 3, "records": 100_000, "api_calls_per_day": 50_000,
                       "members": 15, "premium_agents": True}},
    "business": {"name": "Business", "price_inr_month": 14_999, "description": "Many workflows across teams.",
                 "limits": {"agents": 150, "runs_per_day": 10_000, "concurrent_runs": 6, "records": 1_000_000,
                            "api_calls_per_day": 500_000, "members": 50, "premium_agents": True}},
    "enterprise": {"name": "Enterprise", "price_inr_month": None, "description": "Custom limits, self-hosting, SLAs.",
                   "limits": {"agents": UNLIMITED, "runs_per_day": UNLIMITED, "concurrent_runs": 12, "records": UNLIMITED,
                              "api_calls_per_day": UNLIMITED, "members": UNLIMITED, "premium_agents": True}},
}
BILLING_NOTE = ("Payment checkout is not implemented. Plan changes are made by a platform admin "
                "(PATCH /workspaces/{slug} with a plan).")


def plan_out(key: str) -> dict[str, Any]:
    p = PLANS.get(key) or PLANS["free"]
    return {"key": key if key in PLANS else "free", "name": p["name"], "price_inr_month": p["price_inr_month"],
            "description": p["description"], "limits": dict(p["limits"])}


def limits_of(tenant: Tenant) -> dict[str, Any]:
    return (PLANS.get(tenant.plan or "free") or PLANS["free"])["limits"]


class QuotaExceeded(ApiError):
    def __init__(self, metric: str, limit: int, used: int, message: str) -> None:
        super().__init__(429, "quota_exceeded", message, {"metric": metric, "limit": limit, "used": used})


def _check(metric: str, limit: int, used: int, adding: int, label: str) -> None:
    if limit != UNLIMITED and used + adding > limit:
        raise QuotaExceeded(metric, limit, used, f"Your plan allows {limit} {label}; {used} in use. Ask your platform admin to upgrade.")


def day_start() -> Any:
    return utcnow().replace(hour=0, minute=0, second=0, microsecond=0)


async def runs_today(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    return int((await db.execute(select(func.count()).select_from(PipelineRun).where(
        PipelineRun.tenant_id == tenant_id, PipelineRun.created_at >= day_start()))).scalar_one())


async def check_can_run(db: AsyncSession, tenant: Tenant) -> None:
    """Called before a run is queued (dashboard, API, schedule, webhook)."""
    if tenant.status == "suspended":
        raise ApiError(423, "workspace_suspended", "This workspace is suspended; runs are disabled")
    _check("runs_per_day", limits_of(tenant)["runs_per_day"], await runs_today(db, tenant.id), 1, "runs per day")


async def check_agents(db: AsyncSession, tenant: Tenant, adding: int = 1) -> None:
    used = int((await db.execute(select(func.count()).select_from(Agent).where(Agent.tenant_id == tenant.id))).scalar_one())
    _check("agents", limits_of(tenant)["agents"], used, adding, "agents")


async def check_members(db: AsyncSession, tenant: Tenant) -> None:
    used = int((await db.execute(select(func.count()).select_from(Membership).where(Membership.tenant_id == tenant.id))).scalar_one())
    _check("members", limits_of(tenant)["members"], used, 1, "members")


async def records_used(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    return int((await db.execute(select(func.count()).select_from(DatasetRecord).where(DatasetRecord.tenant_id == tenant_id))).scalar_one())


async def check_records(db: AsyncSession, tenant: Tenant, adding: int = 1) -> None:
    _check("records", limits_of(tenant)["records"], await records_used(db, tenant.id), adding, "dataset records")


async def running_now(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    return int((await db.execute(select(func.count()).select_from(PipelineRun).where(
        PipelineRun.tenant_id == tenant_id, PipelineRun.status == "running"))).scalar_one())


async def bump(tenant_id: uuid.UUID, metric: str, n: int = 1) -> int:
    """Increment today's counter (own transaction) and return the new value."""
    day = utcnow().date().isoformat()
    for _ in range(3):
        async with session_factory()() as db:
            row = (await db.execute(select(UsageCounter).where(
                UsageCounter.tenant_id == tenant_id, UsageCounter.day == day, UsageCounter.metric == metric))).scalar_one_or_none()
            if row is None:
                row = UsageCounter(tenant_id=tenant_id, day=day, metric=metric, count=n)
                db.add(row)
            else:
                row.count += n
            try:
                await db.commit()
                return row.count
            except IntegrityError:  # another request created today's row first
                await db.rollback()
    return 0


async def counter(db: AsyncSession, tenant_id: uuid.UUID, metric: str, day: str | None = None) -> int:
    day = day or utcnow().date().isoformat()
    v = (await db.execute(select(UsageCounter.count).where(
        UsageCounter.tenant_id == tenant_id, UsageCounter.day == day, UsageCounter.metric == metric))).scalar_one_or_none()
    return int(v or 0)


async def count_api_call(tenant: Tenant) -> None:
    limit = limits_of(tenant)["api_calls_per_day"]
    used = await bump(tenant.id, "api_calls")
    if limit != UNLIMITED and used > limit:
        raise QuotaExceeded("api_calls_per_day", limit, used - 1, f"Daily API call limit ({limit}) reached for this workspace")


async def usage(db: AsyncSession, tenant: Tenant) -> dict[str, Any]:
    from app.models import ModelRun

    now = utcnow()
    month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    since30 = (now - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)
    tid = tenant.id

    async def scalar(stmt) -> int:
        return int((await db.execute(stmt)).scalar_one() or 0)

    runs_month = await scalar(select(func.count()).select_from(PipelineRun).where(PipelineRun.tenant_id == tid, PipelineRun.created_at >= month))
    items_month = await scalar(select(func.coalesce(func.sum(PipelineRun.items_out), 0)).where(PipelineRun.tenant_id == tid, PipelineRun.created_at >= month))
    model_month = (await db.execute(select(func.count(), func.coalesce(func.sum(ModelRun.prompt_tokens), 0), func.coalesce(func.sum(ModelRun.completion_tokens), 0))
                                    .where(ModelRun.tenant_id == tid, ModelRun.created_at >= month))).one()
    days = {(since30 + timedelta(days=i)).date().isoformat(): {"runs": 0, "model_tokens": 0, "api_calls": 0} for i in range(30)}
    for created, in (await db.execute(select(PipelineRun.created_at).where(PipelineRun.tenant_id == tid, PipelineRun.created_at >= since30))).all():
        if created.date().isoformat() in days:
            days[created.date().isoformat()]["runs"] += 1
    for created, pt, ct in (await db.execute(select(ModelRun.created_at, ModelRun.prompt_tokens, ModelRun.completion_tokens)
                                             .where(ModelRun.tenant_id == tid, ModelRun.created_at >= since30))).all():
        if created.date().isoformat() in days:
            days[created.date().isoformat()]["model_tokens"] += int(pt or 0) + int(ct or 0)
    for day, n in (await db.execute(select(UsageCounter.day, UsageCounter.count).where(
            UsageCounter.tenant_id == tid, UsageCounter.metric == "api_calls", UsageCounter.day >= since30.date().isoformat()))).all():
        if day in days:
            days[day]["api_calls"] = int(n)
    return {
        "plan": plan_out(tenant.plan or "free"),
        "period_start": month.isoformat(),
        "usage": {
            "agents": await scalar(select(func.count()).select_from(Agent).where(Agent.tenant_id == tid)),
            "members": await scalar(select(func.count()).select_from(Membership).where(Membership.tenant_id == tid)),
            "records": await records_used(db, tid),
            "runs_today": await runs_today(db, tid),
            "runs_month": runs_month,
            "running_now": await running_now(db, tid),
            "api_calls_today": await counter(db, tid, "api_calls"),
            "model_calls_month": int(model_month[0]),
            "model_tokens_month": int(model_month[1]) + int(model_month[2]),
            "items_processed_month": items_month,
        },
        "by_day": [{"day": d, **v} for d, v in days.items()],
        "by_agent": await usage_by_agent(db, tid, month),
        "billing_note": BILLING_NOTE,
    }


async def usage_by_agent(db: AsyncSession, tenant_id: uuid.UUID, since: Any) -> list[dict[str, Any]]:
    """Per-agent usage this month from the step records of runs (executions, items, model calls + tokens, tool calls)."""
    agents = {str(a.id): a for a in (await db.execute(select(Agent).where(Agent.tenant_id == tenant_id))).scalars()}
    acc: dict[str, dict[str, Any]] = {}
    rows = (await db.execute(select(PipelineRun.steps).where(PipelineRun.tenant_id == tenant_id, PipelineRun.created_at >= since))).scalars()
    for steps in rows:
        for s in steps or []:
            aid = s.get("agent_id")
            if not aid or s.get("status") not in ("succeeded", "failed"):
                continue
            a = acc.setdefault(aid, {"runs": 0, "succeeded": 0, "failed": 0, "items_out": 0, "model_calls": 0, "model_tokens": 0, "tool_calls": 0,
                                     "ms": [], "last": None})
            a["runs"] += 1
            a[s["status"]] += 1
            a["items_out"] += int(s.get("items_out") or 0)
            a["model_calls"] += int(s.get("model_calls") or 0)
            a["model_tokens"] += int(s.get("model_tokens") or 0)
            a["tool_calls"] += int(s.get("tool_calls") or 0)
            if s.get("duration_ms") is not None:
                a["ms"].append(int(s["duration_ms"]))
            if s.get("finished_at") and (a["last"] is None or s["finished_at"] > a["last"]):
                a["last"] = s["finished_at"]
    out = []
    for aid, agent in agents.items():
        a = acc.get(aid, {"runs": 0, "succeeded": 0, "failed": 0, "items_out": 0, "model_calls": 0, "model_tokens": 0, "tool_calls": 0, "ms": [], "last": None})
        out.append({"agent_id": aid, "name": agent.name, "kind": agent.kind, "catalog_key": agent.catalog_key, "runs": a["runs"],
                    "succeeded": a["succeeded"], "failed": a["failed"], "items_out": a["items_out"], "model_calls": a["model_calls"],
                    "model_tokens": a["model_tokens"], "tool_calls": a["tool_calls"],
                    "avg_duration_ms": int(sum(a["ms"]) / len(a["ms"])) if a["ms"] else None, "last_run_at": a["last"]})
    return sorted(out, key=lambda x: (-x["runs"], x["name"]))
