"""Workflows (pipelines: ordered agent/approval steps + trigger), their versions, and runs (list, detail,
events, cancel, approve, reject)."""

from __future__ import annotations

import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Body, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import utcnow
from app.core.deps import Principal, current_principal, get_db, require
from app.core.errors import ApiError
from app.core.security import encrypt_secret
from app.models import Agent, ContentItem, Job, Pipeline, PipelineRun, PipelineVersion, User
from app.platform.catalog import ConfigError, validate_config
from app.platform.routers.agents import events_query
from app.platform.runtime import event_row, resume_run, start_run, tenant_agents
from app.platform.schemas import (
    PipelinePatch,
    PipelineWrite,
    RunDecision,
    RunRequest,
    StepWrite,
    TriggerWrite,
)
from app.platform.serializers import iso, pipeline_out, run_out
from app.routers.common import owned

router = APIRouter(tags=["pipelines"])


async def _steps(db: AsyncSession, tenant_id: uuid.UUID, steps: list[StepWrite]) -> list[dict]:
    agents = await tenant_agents(db, tenant_id)
    out, problems = [], []
    for i, s in enumerate(steps):
        base = {"id": s.id or uuid.uuid4().hex, "type": s.type, "condition": s.condition.model_dump() if s.condition else None,
                "on_error": s.on_error, "retries": s.retries if s.on_error == "retry" else 0, "label": s.label}
        if s.type == "approval":
            out.append({**base, "agent_id": None, "overrides": {}})
            continue
        agent = agents.get(s.agent_id or "")
        if agent is None:
            problems.append(f"Step {i + 1}: agent not found in this workspace")
            continue
        if s.overrides:
            try:
                validate_config(agent.kind, s.overrides, partial=True)
            except ConfigError as exc:
                problems += [f"Step {i + 1} ({agent.name}): {p}" for p in exc.problems]
        out.append({**base, "agent_id": str(agent.id), "overrides": s.overrides or {}})
    if problems:
        raise ApiError(422, "invalid_steps", "Pipeline steps are invalid", problems)
    return out


def _apply_trigger(p: Pipeline, trigger: TriggerWrite) -> None:
    if trigger.type == "schedule" and not trigger.every_minutes:
        raise ApiError(422, "invalid_trigger", "A schedule trigger needs every_minutes (at least 5)")
    changed = p.trigger_type != trigger.type or p.every_minutes != trigger.every_minutes
    p.trigger_type = trigger.type
    p.every_minutes = trigger.every_minutes if trigger.type == "schedule" else None
    if not p.webhook_token_enc:
        p.webhook_token_enc = encrypt_secret(secrets.token_urlsafe(24))
    if trigger.type != "schedule":
        p.next_run_at = None
    elif changed or p.next_run_at is None:
        p.next_run_at = utcnow() + timedelta(minutes=p.every_minutes or 60)


def _version(db: AsyncSession, p: Pipeline, user_id: uuid.UUID | None) -> None:
    db.add(PipelineVersion(tenant_id=p.tenant_id, pipeline_id=p.id, version=p.version, steps=p.steps or [],
                           trigger={"type": p.trigger_type, "every_minutes": p.every_minutes}, created_by=user_id))


async def _out(db: AsyncSession, p: Pipeline, agents: dict[str, Agent] | None = None, *, reveal: bool = True) -> dict:
    agents = agents if agents is not None else await tenant_agents(db, p.tenant_id)
    last = (await db.execute(
        select(PipelineRun).where(PipelineRun.pipeline_id == p.id).order_by(PipelineRun.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    n7 = (await db.execute(select(func.count()).select_from(PipelineRun).where(
        PipelineRun.pipeline_id == p.id, PipelineRun.created_at >= utcnow() - timedelta(days=7)))).scalar_one()
    return pipeline_out(p, agents, last_run=last, runs_7d=int(n7), reveal=reveal)


@router.get("/pipelines")
async def list_pipelines(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    agents = await tenant_agents(db, principal.tenant_id)
    rows = (await db.execute(select(Pipeline).where(Pipeline.tenant_id == principal.tenant_id).order_by(Pipeline.created_at))).scalars()
    # Webhook URLs carry the trigger secret: never shown under support access.
    return {"items": [await _out(db, p, agents, reveal=not principal.support_access) for p in rows]}


@router.post("/pipelines")
async def create_pipeline(body: PipelineWrite, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    p = Pipeline(
        tenant_id=principal.tenant_id, name=body.name, description=body.description or "",
        steps=await _steps(db, principal.tenant_id, body.steps),
        require_approval=True if body.require_approval is None else body.require_approval,
        enabled=True if body.enabled is None else body.enabled, version=1,
    )
    _apply_trigger(p, body.trigger)
    db.add(p)
    await db.flush()
    _version(db, p, principal.user.id)
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="pipeline.created", entity="pipeline",
          entity_id=p.id, detail={"message": f"Pipeline {p.name} created"})
    await db.commit()
    return await _out(db, p)


@router.get("/pipelines/{pipeline_id}")
async def get_pipeline(pipeline_id: str, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    return await _out(db, await owned(db, Pipeline, pipeline_id, principal.tenant_id, "pipeline"), reveal=not principal.support_access)


@router.patch("/pipelines/{pipeline_id}")
async def patch_pipeline(pipeline_id: str, body: PipelinePatch, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    p = await owned(db, Pipeline, pipeline_id, principal.tenant_id, "pipeline")
    data = body.model_dump(exclude_unset=True)
    before = (p.steps, p.trigger_type, p.every_minutes)
    if body.steps is not None:
        p.steps = await _steps(db, principal.tenant_id, body.steps)
    if body.trigger is not None:
        _apply_trigger(p, body.trigger)
    for k in ("name", "description", "require_approval", "enabled"):
        if data.get(k) is not None:
            setattr(p, k, data[k])
    if p.enabled and p.trigger_type == "schedule" and p.next_run_at is None:
        p.next_run_at = utcnow() + timedelta(minutes=p.every_minutes or 60)
    if (p.steps, p.trigger_type, p.every_minutes) != before:
        p.version = (p.version or 1) + 1
        _version(db, p, principal.user.id)
    p.updated_at = utcnow()
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="pipeline.updated", entity="pipeline",
          entity_id=p.id, detail={"message": f"Pipeline {p.name} updated (v{p.version})"})
    await db.commit()
    return await _out(db, p)


@router.get("/pipelines/{pipeline_id}/versions")
async def pipeline_versions(pipeline_id: str, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    p = await owned(db, Pipeline, pipeline_id, principal.tenant_id, "pipeline")
    rows = (await db.execute(select(PipelineVersion, User.email).outerjoin(User, User.id == PipelineVersion.created_by)
                             .where(PipelineVersion.pipeline_id == p.id).order_by(PipelineVersion.version.desc()))).all()
    return {"items": [{"version": v.version, "steps": v.steps, "trigger": v.trigger, "created_by": email, "created_at": iso(v.created_at)}
                      for v, email in rows]}


@router.delete("/pipelines/{pipeline_id}", status_code=204)
async def delete_pipeline(pipeline_id: str, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    p = await owned(db, Pipeline, pipeline_id, principal.tenant_id, "pipeline")
    await db.delete(p)
    await db.commit()
    return Response(status_code=204)


@router.post("/pipelines/{pipeline_id}/run")
async def run_pipeline(
    pipeline_id: str,
    body: RunRequest | None = Body(default=None),
    principal: Principal = Depends(require("agents.run")),
    db: AsyncSession = Depends(get_db),
):
    p = await owned(db, Pipeline, pipeline_id, principal.tenant_id, "pipeline")
    if not p.steps:
        raise ApiError(422, "empty_pipeline", "Add at least one step before running the pipeline")
    run = await start_run(db, p, trigger="manual", input=body.input.model_dump(exclude_none=True) if body and body.input else None,
                          created_by=principal.user.id)
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="run.started", entity="pipeline_run",
          entity_id=run.id, detail={"pipeline": p.name, "message": "Run started manually"})
    await db.commit()
    return run_out(run, p.name)


async def _run_name(db: AsyncSession, run: PipelineRun) -> str:
    if run.pipeline_id:
        p = await db.get(Pipeline, run.pipeline_id)
        return p.name if p else "(deleted pipeline)"
    a = await db.get(Agent, run.agent_id) if run.agent_id else None
    return a.name if a else "(deleted agent)"


@router.get("/runs")
async def list_runs(
    pipeline_id: str | None = None,
    agent_id: str | None = None,
    status: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(PipelineRun).where(PipelineRun.tenant_id == principal.tenant_id)
    try:
        if pipeline_id:
            stmt = stmt.where(PipelineRun.pipeline_id == uuid.UUID(pipeline_id))
        if agent_id:
            stmt = stmt.where(PipelineRun.agent_id == uuid.UUID(agent_id))
    except ValueError:
        return {"items": []}
    if status:
        stmt = stmt.where(PipelineRun.status == status)
    rows = list((await db.execute(stmt.order_by(PipelineRun.created_at.desc()).limit(limit))).scalars())
    names = dict((await db.execute(select(Pipeline.id, Pipeline.name).where(Pipeline.tenant_id == principal.tenant_id))).all())
    names.update(dict((await db.execute(select(Agent.id, Agent.name).where(Agent.tenant_id == principal.tenant_id))).all()))
    return {"items": [run_out(r, names.get(r.pipeline_id or r.agent_id, "(deleted)")) for r in rows]}


@router.get("/runs/{run_id}")
async def get_run(run_id: str, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    run = await owned(db, PipelineRun, run_id, principal.tenant_id, "run")
    return run_out(run, await _run_name(db, run))


@router.get("/runs/{run_id}/events")
async def run_events(run_id: str, after: int | None = None, limit: int = Query(200, ge=1, le=1000),
                     principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    run = await owned(db, PipelineRun, run_id, principal.tenant_id, "run")
    return {"items": await events_query(db, principal.tenant_id, after=after, limit=limit, run_id=run.id)}


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, principal: Principal = Depends(require("agents.run")), db: AsyncSession = Depends(get_db)):
    run = await owned(db, PipelineRun, run_id, principal.tenant_id, "run")
    if run.status in ("queued", "awaiting_approval"):
        run.status = "cancelled"
        run.finished_at = utcnow()
        run.steps = [{**s, "status": "skipped"} if s.get("status") in ("pending", "running") else s for s in run.steps or []]
        for job in (await db.execute(select(Job).where(Job.type == "pipeline_run", Job.status == "queued", Job.tenant_id == run.tenant_id))).scalars():
            if (job.payload or {}).get("run_id") == str(run.id):
                job.status = "failed"
                job.last_error = "Run cancelled"
                job.finished_at = utcnow()
        db.add(event_row(run.tenant_id, "run.cancelled", f"Cancelled by {principal.user.email}", run_id=run.id))
    elif run.status == "running":
        run.cancel_requested = True  # the runtime stops at the next item/step boundary
    await db.commit()
    return run_out(run, await _run_name(db, run))


@router.post("/runs/{run_id}/approve")
async def approve_run(run_id: str, body: RunDecision | None = Body(default=None), principal: Principal = Depends(require("content.approve")),
                      db: AsyncSession = Depends(get_db)):
    """Approve a paused run: an approval step passes, an external-action agent may act, and the run's draft content
    is approved for its publisher. The run continues from the paused step."""
    run = await owned(db, PipelineRun, run_id, principal.tenant_id, "run")
    if run.status != "awaiting_approval" or run.resume_step is None:
        raise ApiError(409, "not_awaiting_approval", "This run is not waiting for approval")
    steps = [dict(s) for s in run.steps or []]
    step = steps[run.resume_step]
    step["approved"] = True
    step["logs"] = [*(step.get("logs") or []), {"at": utcnow().isoformat(), "level": "info",
                                                "message": f"Approved by {principal.user.email}" + (f": {body.note}" if body and body.note else "")}]
    run.steps = steps
    drafts = (await db.execute(select(ContentItem).where(ContentItem.run_id == run.id, ContentItem.status == "draft"))).scalars()
    for c in drafts:
        c.status = "approved"
    db.add(event_row(run.tenant_id, "step.log", f"Approved by {principal.user.email}", run_id=run.id, step_id=step.get("step_id")))
    await resume_run(db, run)
    audit(db, tenant_id=run.tenant_id, actor_type="user", actor_id=principal.user.id, action="run.approved", entity="pipeline_run",
          entity_id=run.id, detail={"message": f"Run approved at step {step.get('agent_name')}"})
    await db.commit()
    return run_out(run, await _run_name(db, run))


@router.post("/runs/{run_id}/reject")
async def reject_run(run_id: str, body: RunDecision | None = Body(default=None), principal: Principal = Depends(require("content.approve")),
                     db: AsyncSession = Depends(get_db)):
    run = await owned(db, PipelineRun, run_id, principal.tenant_id, "run")
    if run.status != "awaiting_approval" or run.resume_step is None:
        raise ApiError(409, "not_awaiting_approval", "This run is not waiting for approval")
    reason = (body.reason or body.note) if body else None
    steps = [dict(s) for s in run.steps or []]
    steps[run.resume_step].update(status="failed", error=f"Rejected by {principal.user.email}" + (f": {reason}" if reason else ""))
    for s in steps[run.resume_step + 1 :]:
        s["status"] = "skipped"
    run.steps, run.status, run.finished_at, run.resume_step = steps, "cancelled", utcnow(), None
    run.error = f"Rejected: {reason}" if reason else "Rejected"
    for c in (await db.execute(select(ContentItem).where(ContentItem.run_id == run.id, ContentItem.status == "draft"))).scalars():
        c.status, c.reject_reason = "rejected", reason or "Run rejected"
    db.add(event_row(run.tenant_id, "run.cancelled", f"Rejected by {principal.user.email}" + (f": {reason}" if reason else ""), run_id=run.id))
    audit(db, tenant_id=run.tenant_id, actor_type="user", actor_id=principal.user.id, action="run.rejected", entity="pipeline_run",
          entity_id=run.id, detail={"message": f"Run rejected: {reason or '-'}"})
    await db.commit()
    return run_out(run, await _run_name(db, run))
