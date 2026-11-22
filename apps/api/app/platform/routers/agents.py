"""Agents: catalogue + activation, CRUD, lifecycle (run / pause / resume / disable / schedule), versions,
executions, outputs, live events and the agents overview. Also the agent-kind and tool registries."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import utcnow
from app.core.deps import Principal, current_principal, get_db, require
from app.core.errors import ApiError, bad_request, not_found
from app.models import (
    Agent,
    AgentVersion,
    Connection,
    Dataset,
    ExecutionEvent,
    Pipeline,
    PipelineRun,
    Tenant,
    User,
)
from app.platform import stats as st
from app.platform.catalog import AGENT_KINDS, ConfigError, validate_config
from app.platform.catalog_agents import catalog as load_catalog
from app.platform.catalog_agents import entitled
from app.platform.events import event_out
from app.platform.flow import FlowItem
from app.platform.plans import check_agents, limits_of
from app.platform.runtime import run_agent_inline, start_run
from app.platform.schemas import ActivateIn, AgentPatch, AgentTestRequest, AgentWrite, RunRequest
from app.platform.serializers import agent_out, iso, run_out
from app.platform.tools import KIND_TOOLS, TOOLS
from app.routers.common import owned

router = APIRouter(tags=["agents"])


@router.get("/agent-types")
async def agent_types(_: Principal = Depends(current_principal)):
    return {"items": [k.out() for k in AGENT_KINDS.values()]}


@router.get("/tools")
async def tools(_: Principal = Depends(current_principal)):
    return {"items": [t.out() for t in TOOLS.values()]}


async def check_config(db: AsyncSession, tenant_id: uuid.UUID, kind: str, config: dict[str, Any] | None, *, partial: bool = False,
                       require_fields: bool = True) -> dict[str, Any]:
    """Schema validation + references (datasets / connections must belong to the workspace)."""
    try:
        cfg = validate_config(kind, config, partial=partial, require=require_fields)
    except ConfigError as exc:
        raise ApiError(422, "invalid_config", "Agent settings are invalid", exc.problems) from exc
    problems = []
    for f in AGENT_KINDS[kind].config_schema:
        value = cfg.get(f["key"])
        if f["type"] == "dataset" and value and not await _belongs(db, Dataset, value, tenant_id):
            problems.append(f"{f['label']}: dataset not found in this workspace")
        if f["type"] == "connections" and value:
            missing = [c for c in value if not await _belongs(db, Connection, c, tenant_id)]
            if missing:
                problems.append(f"{f['label']}: {len(missing)} connection(s) not found in this workspace")
    if problems:
        raise ApiError(422, "invalid_config", "Agent settings are invalid", problems)
    return cfg


async def _belongs(db: AsyncSession, model: Any, value: str, tenant_id: uuid.UUID) -> bool:
    try:
        row = await db.get(model, uuid.UUID(str(value)))
    except ValueError:
        return False
    return row is not None and row.tenant_id == tenant_id


async def live_map(db: AsyncSession, tenant_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    """agent id -> what it is doing right now (from running runs' step records)."""
    out: dict[str, dict[str, Any]] = {}
    for run in (await db.execute(select(PipelineRun).where(PipelineRun.tenant_id == tenant_id, PipelineRun.status == "running"))).scalars():
        for s in run.steps or []:
            if s.get("status") == "running" and s.get("agent_id"):
                logs = s.get("logs") or []
                out[s["agent_id"]] = {"run_id": str(run.id), "started_at": s.get("started_at"), "message": logs[-1]["message"] if logs else None}
    return out


async def _out(db: AsyncSession, a: Agent) -> dict[str, Any]:
    return agent_out(a, (await st.agent_stats(db, a.tenant_id)).get(str(a.id)), (await live_map(db, a.tenant_id)).get(str(a.id)))


def _snapshot(db: AsyncSession, a: Agent, user_id: uuid.UUID | None, note: str | None) -> None:
    db.add(AgentVersion(tenant_id=a.tenant_id, agent_id=a.id, version=a.version, config=a.config or {}, model=a.model, note=note, created_by=user_id))


def _set_schedule(a: Agent, every: int | None) -> None:
    if every is not None and every < 5:
        raise ApiError(422, "invalid_schedule", "every_minutes must be at least 5")
    a.every_minutes = every or None
    a.next_run_at = utcnow() + timedelta(minutes=every) if every and a.status == "active" else None


def _unique_name(base: str, taken: set[str]) -> str:
    name, n = base, 2
    while name in taken:
        name, n = f"{base} {n}", n + 1
    return name


# ---------------------------------------------------------------- catalogue
@router.get("/catalog")
async def catalog(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    limits = limits_of(principal.tenant)
    activated: dict[str, list[str]] = {}
    for key, aid in (await db.execute(select(Agent.catalog_key, Agent.id).where(Agent.tenant_id == principal.tenant_id, Agent.catalog_key.is_not(None)))).all():
        activated.setdefault(key, []).append(str(aid))
    return {"items": [e.out(entitled=entitled(e, limits, principal.tenant.plan or "free"), activated=activated.get(e.key, []))
                      for e in load_catalog().values()]}


@router.post("/catalog/{key}/activate")
async def activate(key: str, body: ActivateIn | None = Body(default=None), principal: Principal = Depends(require("agents.manage")),
                   db: AsyncSession = Depends(get_db)):
    entry = load_catalog().get(key)
    if entry is None:
        raise not_found("catalogue agent")
    tenant = await db.get(Tenant, principal.tenant_id)
    if not entitled(entry, limits_of(tenant), tenant.plan or "free"):
        needs = "Business plan or above" if entry.tier == "enterprise" else "Pro plan or above"
        raise ApiError(403, "upgrade_required", f"{entry.name} needs the {needs} (this workspace is on {tenant.plan}).",
                       {"tier": entry.tier, "plan": tenant.plan})
    await check_agents(db, tenant)
    taken = set((await db.execute(select(Agent.name).where(Agent.tenant_id == tenant.id))).scalars())
    info = AGENT_KINDS[entry.kind]
    agent = Agent(tenant_id=tenant.id, name=_unique_name((body.name if body and body.name else None) or entry.name, taken), kind=entry.kind,
                  description=entry.description, config=await check_config(db, tenant.id, entry.kind, entry.config, require_fields=False),
                  model=entry.model or info.default_model or "fast", status="active", enabled=True, source="platform", catalog_key=entry.key,
                  tools=entry.tool_keys, limits={})
    db.add(agent)
    await db.flush()
    _snapshot(db, agent, principal.user.id, f"Activated from catalogue ({entry.key} v{entry.version})")
    audit(db, tenant_id=tenant.id, actor_type="user", actor_id=principal.user.id, action="agent.activated", entity="agent", entity_id=agent.id,
          detail={"message": f"Activated {entry.name}", "catalog_key": entry.key})
    await db.commit()
    return await _out(db, agent)


# ---------------------------------------------------------------- overview
@router.get("/agents/overview")
async def overview(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    tid = principal.tenant_id
    agents = list((await db.execute(select(Agent).where(Agent.tenant_id == tid))).scalars())
    live = await live_map(db, tid)
    since7, since24 = utcnow() - timedelta(days=7), utcnow() - timedelta(hours=24)
    execs = ok = done = items = 0
    for steps in (await db.execute(select(PipelineRun.steps).where(PipelineRun.tenant_id == tid, PipelineRun.created_at >= since7))).scalars():
        for s in steps or []:
            if s.get("type") == "approval" or s.get("status") not in ("succeeded", "failed"):
                continue
            execs += 1
            done += 1
            ok += s["status"] == "succeeded"
            items += int(s.get("items_out") or 0)
    awaiting = (await db.execute(select(func.count()).select_from(PipelineRun).where(PipelineRun.tenant_id == tid, PipelineRun.status == "awaiting_approval"))).scalar_one()
    failed = (await db.execute(select(func.count()).select_from(PipelineRun).where(PipelineRun.tenant_id == tid, PipelineRun.status == "failed",
                                                                                  PipelineRun.created_at >= since24))).scalar_one()
    upcoming = [{"agent_id": str(a.id), "pipeline_id": None, "name": a.name, "at": iso(a.next_run_at)} for a in agents if a.next_run_at and a.status == "active"]
    for p in (await db.execute(select(Pipeline).where(Pipeline.tenant_id == tid, Pipeline.enabled.is_(True), Pipeline.next_run_at.is_not(None)))).scalars():
        upcoming.append({"agent_id": None, "pipeline_id": str(p.id), "name": p.name, "at": iso(p.next_run_at)})
    recent = (await db.execute(select(ExecutionEvent).where(ExecutionEvent.tenant_id == tid).order_by(ExecutionEvent.id.desc()).limit(20))).scalars()
    active = [a for a in agents if a.status == "active"]
    return {
        "totals": {
            "activated": len(agents), "running": len(live), "idle": sum(1 for a in active if str(a.id) not in live),
            "paused": sum(1 for a in agents if a.status == "paused"), "scheduled": sum(1 for a in active if a.every_minutes),
            "awaiting_approval": int(awaiting), "failed_24h": int(failed), "executions_7d": execs, "items_processed_7d": items,
            "success_rate_7d": round(ok / done, 3) if done else None,
        },
        "upcoming": sorted(upcoming, key=lambda u: u["at"])[:10],
        "recent": [event_out(e) for e in recent],
    }


# ---------------------------------------------------------------- CRUD
@router.get("/agents")
async def list_agents(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Agent).where(Agent.tenant_id == principal.tenant_id).order_by(Agent.created_at))).scalars()
    stats = await st.agent_stats(db, principal.tenant_id)
    live = await live_map(db, principal.tenant_id)
    return {"items": [agent_out(a, stats.get(str(a.id)), live.get(str(a.id))) for a in rows]}


@router.post("/agents")
async def create_agent(body: AgentWrite, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    if body.kind not in AGENT_KINDS:
        raise bad_request("unknown_kind", f"Unknown agent kind '{body.kind}'")
    tenant = await db.get(Tenant, principal.tenant_id)
    await check_agents(db, tenant)
    info = AGENT_KINDS[body.kind]
    status = "active" if body.enabled is not False else "disabled"
    agent = Agent(
        tenant_id=principal.tenant_id, name=body.name, kind=body.kind, description=body.description or "",
        config=await check_config(db, principal.tenant_id, body.kind, body.config),
        model=body.model or info.default_model or "fast", enabled=status == "active", status=status, source="custom",
        tools=list(KIND_TOOLS.get(body.kind, [])), limits=_limits(body.limits) if body.limits else {},
        requires_approval=bool(body.requires_approval),
    )
    if body.schedule is not None:
        _set_schedule(agent, body.schedule.every_minutes)
    db.add(agent)
    await db.flush()
    _snapshot(db, agent, principal.user.id, "Created")
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="agent.created", entity="agent",
          entity_id=agent.id, detail={"message": f"Agent {agent.name} ({info.name}) created"})
    await db.commit()
    return await _out(db, agent)


def _limits(limits: Any) -> dict[str, Any]:
    data = limits.model_dump(exclude_none=True)
    return {k: v for k, v in data.items() if v is not None}


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    return await _out(db, await owned(db, Agent, agent_id, principal.tenant_id, "agent"))


@router.patch("/agents/{agent_id}")
async def patch_agent(agent_id: str, body: AgentPatch, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    if body.kind is not None and body.kind != agent.kind:
        raise bad_request("kind_immutable", "An agent's kind cannot change; create a new agent instead")
    data = body.model_dump(exclude_unset=True)
    changed = False
    if "config" in data:
        new_cfg = await check_config(db, principal.tenant_id, agent.kind, data["config"])
        changed = changed or new_cfg != (agent.config or {})
        agent.config = new_cfg
    if data.get("model") and data["model"] != agent.model:
        agent.model, changed = data["model"], True
    for k in ("name", "description"):
        if data.get(k) is not None:
            setattr(agent, k, data[k])
    if data.get("enabled") is not None:
        agent.status = "active" if data["enabled"] else "disabled"
        agent.enabled = data["enabled"]
    if body.requires_approval is not None:
        agent.requires_approval = body.requires_approval
    if body.limits is not None:
        agent.limits = {**(agent.limits or {}), **_limits(body.limits)}
    if body.schedule is not None:
        _set_schedule(agent, body.schedule.every_minutes)
    if changed:
        agent.version = (agent.version or 1) + 1
        _snapshot(db, agent, principal.user.id, body.version_note)
    agent.updated_at = utcnow()
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="agent.updated", entity="agent",
          entity_id=agent.id, detail={"message": f"Agent {agent.name} updated" + (f" (v{agent.version})" if changed else "")})
    await db.commit()
    await db.refresh(agent)
    return await _out(db, agent)


@router.delete("/agents/{agent_id}", status_code=204)
async def delete_agent(agent_id: str, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    using = [p.name for p in (await db.execute(select(Pipeline).where(Pipeline.tenant_id == principal.tenant_id))).scalars()
             if any(str(s.get("agent_id")) == str(agent.id) for s in p.steps or [])]
    if using:
        raise ApiError(409, "agent_in_use", f"Used by pipeline(s): {', '.join(using)}. Remove it from them first.", {"pipelines": using})
    await db.delete(agent)
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="agent.deleted", entity="agent",
          entity_id=agent.id, detail={"message": f"Agent {agent.name} deleted"})
    await db.commit()
    return Response(status_code=204)


@router.post("/agents/{agent_id}/test")
async def test_agent(agent_id: str, body: AgentTestRequest, principal: Principal = Depends(require("agents.run")), db: AsyncSession = Depends(get_db)):
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    if body.config_override:
        try:
            validate_config(agent.kind, body.config_override, partial=True)
        except ConfigError as exc:
            raise ApiError(422, "invalid_config", "Override settings are invalid", exc.problems) from exc
    tenant = await db.get(Tenant, principal.tenant_id)
    return await run_agent_inline(
        tenant, agent, input=body.input.model_dump(exclude_none=True) if body.input else None, config_override=body.config_override
    )


# ---------------------------------------------------------------- lifecycle
@router.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, body: RunRequest | None = Body(default=None), principal: Principal = Depends(require("agents.run")),
                    db: AsyncSession = Depends(get_db)):
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    if agent.status != "active":
        raise ApiError(409, "agent_not_active", f"{agent.name} is {agent.status}; resume it first")
    run = await start_run(db, agent=agent, trigger="manual", input=body.input.model_dump(exclude_none=True) if body and body.input else None,
                          created_by=principal.user.id)
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="run.started", entity="pipeline_run",
          entity_id=run.id, detail={"pipeline": agent.name, "message": "Agent run started manually"})
    await db.commit()
    return run_out(run, agent.name)


async def _set_status(db: AsyncSession, principal: Principal, agent_id: str, status: str) -> dict[str, Any]:
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    agent.status, agent.enabled = status, status == "active"
    if status == "active" and agent.every_minutes:
        agent.next_run_at = utcnow() + timedelta(minutes=agent.every_minutes)
    elif status != "active":
        agent.next_run_at = None
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action=f"agent.{status}", entity="agent",
          entity_id=agent.id, detail={"message": f"Agent {agent.name} {status}"})
    await db.commit()
    return await _out(db, agent)


@router.post("/agents/{agent_id}/pause")
async def pause_agent(agent_id: str, principal: Principal = Depends(require("agents.run")), db: AsyncSession = Depends(get_db)):
    return await _set_status(db, principal, agent_id, "paused")


@router.post("/agents/{agent_id}/resume")
async def resume_agent(agent_id: str, principal: Principal = Depends(require("agents.run")), db: AsyncSession = Depends(get_db)):
    return await _set_status(db, principal, agent_id, "active")


@router.post("/agents/{agent_id}/disable")
async def disable_agent(agent_id: str, principal: Principal = Depends(require("agents.run")), db: AsyncSession = Depends(get_db)):
    return await _set_status(db, principal, agent_id, "disabled")


# ---------------------------------------------------------------- versions
@router.get("/agents/{agent_id}/versions")
async def versions(agent_id: str, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    rows = (await db.execute(select(AgentVersion, User.email).outerjoin(User, User.id == AgentVersion.created_by)
                             .where(AgentVersion.agent_id == agent.id).order_by(AgentVersion.version.desc()))).all()
    return {"items": [{"version": v.version, "config": v.config, "model": v.model, "note": v.note, "created_by": email,
                       "created_at": iso(v.created_at)} for v, email in rows]}


@router.post("/agents/{agent_id}/versions/{version}/restore")
async def restore(agent_id: str, version: int, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    v = (await db.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id, AgentVersion.version == version))).scalar_one_or_none()
    if v is None:
        raise not_found("version")
    agent.config = await check_config(db, principal.tenant_id, agent.kind, v.config, require_fields=False)
    agent.model = v.model
    agent.version = (agent.version or 1) + 1
    _snapshot(db, agent, principal.user.id, f"Restored v{version}")
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="agent.restored", entity="agent",
          entity_id=agent.id, detail={"message": f"Agent {agent.name}: restored v{version} as v{agent.version}"})
    await db.commit()
    return await _out(db, agent)


# ---------------------------------------------------------------- executions, outputs, events
async def _agent_steps(db: AsyncSession, agent: Agent, limit: int) -> list[tuple[PipelineRun, dict[str, Any]]]:
    out = []
    rows = (await db.execute(select(PipelineRun).where(PipelineRun.tenant_id == agent.tenant_id).order_by(PipelineRun.created_at.desc()).limit(400))).scalars()
    for run in rows:
        for s in run.steps or []:
            if s.get("agent_id") == str(agent.id):
                out.append((run, s))
        if len(out) >= limit:
            break
    return out[:limit]


def _exec_status(run: PipelineRun, s: dict[str, Any]) -> str:
    if run.status in ("queued", "awaiting_approval", "cancelled") and s.get("status") == "pending":
        return run.status
    return {"pending": "queued"}.get(s.get("status"), s.get("status") or "queued")


@router.get("/agents/{agent_id}/executions")
async def executions(agent_id: str, limit: int = Query(50, ge=1, le=200), principal: Principal = Depends(current_principal),
                     db: AsyncSession = Depends(get_db)):
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    names = dict((await db.execute(select(Pipeline.id, Pipeline.name).where(Pipeline.tenant_id == principal.tenant_id))).all())
    return {"items": [{
        "run_id": str(run.id), "step_id": s.get("step_id"), "pipeline_id": str(run.pipeline_id) if run.pipeline_id else None,
        "pipeline_name": names.get(run.pipeline_id) if run.pipeline_id else None, "trigger": run.trigger, "status": _exec_status(run, s),
        "started_at": s.get("started_at"), "finished_at": s.get("finished_at"), "duration_ms": s.get("duration_ms"),
        "items_in": s.get("items_in") or 0, "items_out": s.get("items_out") or 0, "tools_used": s.get("tools_used") or [],
        "attempts": s.get("attempts") or 0, "model_calls": s.get("model_calls") or 0, "error": s.get("error"),
    } for run, s in await _agent_steps(db, agent, limit)]}


@router.get("/agents/{agent_id}/outputs")
async def outputs(agent_id: str, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    for _run, s in await _agent_steps(db, agent, 100):
        if s.get("status") == "succeeded":
            o = s.get("outputs") or {}
            return {"items": [FlowItem.from_dict(i).out() for i in s.get("output") or []], "content_ids": o.get("content_ids") or [],
                    "dataset_changes": o.get("dataset_changes"), "report": o.get("report")}
    return {"items": [], "content_ids": [], "dataset_changes": None, "report": None}


@router.get("/agents/{agent_id}/events")
async def agent_events(agent_id: str, after: int | None = None, limit: int = Query(100, ge=1, le=500),
                       principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    agent = await owned(db, Agent, agent_id, principal.tenant_id, "agent")
    return {"items": await events_query(db, principal.tenant_id, after=after, limit=limit, agent_id=agent.id)}


async def events_query(db: AsyncSession, tenant_id: uuid.UUID, *, after: int | None, limit: int, agent_id: uuid.UUID | None = None,
                       run_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
    """Events in ascending id order. Without `after`, the latest `limit` events."""
    stmt = select(ExecutionEvent).where(ExecutionEvent.tenant_id == tenant_id)
    if agent_id is not None:
        stmt = stmt.where(ExecutionEvent.agent_id == agent_id)
    if run_id is not None:
        stmt = stmt.where(ExecutionEvent.run_id == run_id)
    if after is not None:
        rows = list((await db.execute(stmt.where(ExecutionEvent.id > after).order_by(ExecutionEvent.id).limit(limit))).scalars())
    else:
        rows = list(reversed(list((await db.execute(stmt.order_by(ExecutionEvent.id.desc()).limit(limit))).scalars())))
    return [event_out(e) for e in rows]
