"""Workflow runtime: executes a run's steps in order, passing FlowItems from one agent to the next.

A run is either a pipeline run or a single-agent run (pipeline_id NULL). Each step is an agent step or an
approval step and may carry a condition (skip when false), an error policy (stop / continue / retry) and a
label. Progress is written to `pipeline_runs.steps` as it happens and every real action is recorded as an
execution event (run/step lifecycle, tool calls, model calls), so the dashboard can poll or stream a run live.

Approval: an approval step, an agent with `requires_approval` whose kind acts externally, or a publisher with
draft content pauses the run (`awaiting_approval`) with its items stored; approving resumes it at that step.
Runs are not blindly retried by the queue: a half-finished run has already produced output. Steps retry only
when their workflow says so (`on_error: retry`)."""

from __future__ import annotations

import asyncio
import copy
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, TypeVar

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, AgentOutputError, TenantSnapshot, structured
from app.core.audit import audit
from app.core.config import get_settings
from app.core.db import session_factory, utcnow
from app.models import Agent, ExecutionEvent, Pipeline, PipelineRun, Tenant
from app.platform.catalog import AGENT_KINDS, ConfigError, validate_config
from app.platform.events import emit, notify, redact
from app.platform.flow import FlowItem, items_from_input
from app.queue.jobs import JobError, PermanentError, RetryableError, enqueue

T = TypeVar("T", bound=BaseModel)
KindRunner = Callable[["RunContext", dict[str, Any], list[FlowItem]], Awaitable[list[FlowItem]]]
SIDE_EFFECT_KINDS = frozenset({"auto_publisher", "http_action", "notifier"})
DEFAULT_TIMEOUT_S = 1800
CONCURRENCY_RETRY_S = 15
# A second attempt exists only for crash recovery (worker died mid-run): step failures raise PermanentError and
# are never retried by the queue.
RUN_JOB_ATTEMPTS = 2


class AwaitingApproval(Exception):
    """Raised by the publisher when items still need a human decision."""

    def __init__(self, pending: int) -> None:
        super().__init__(f"{pending} item(s) waiting for approval")
        self.pending = pending


class RunCancelled(Exception):
    pass


def model_profiles(tenant_settings: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    """Capability-aware model profiles (role → model). A workspace may override the instance models in its
    settings (`platform_models: {"fast": "...", "writer": "..."}`)."""
    s = get_settings()
    over = (tenant_settings or {}).get("platform_models") or {}
    return {
        "fast": {"role": "fast", "model": over.get("fast") or s.model_fast, "supports_json": True, "context": s.model_num_ctx},
        "writer": {"role": "writer", "model": over.get("writer") or s.model_writer, "supports_json": True, "context": s.model_num_ctx},
        "embed": {"role": "embed", "model": over.get("embed") or s.model_embed, "supports_json": False, "context": 2048},
    }


def resolve_model(model: str | None, tenant_settings: dict[str, Any] | None = None) -> str:
    """Agent model aliases: "fast" and "writer" follow the workspace/instance profiles; anything else is an explicit
    model tag (e.g. "llama3.1:8b")."""
    m = (model or "fast").strip()
    profiles = model_profiles(tenant_settings)
    return profiles[m]["model"] if m in ("fast", "writer") else m


def iso_now() -> str:
    return utcnow().isoformat()


@dataclass
class StepAgent:
    id: str
    name: str
    kind: str
    model: str
    tools: list[str] = field(default_factory=list)
    limits: dict[str, Any] = field(default_factory=dict)


@dataclass
class RunContext:
    """What a kind sees while it runs: the agent, its run, logging, events, tools and model access."""

    agent_ctx: AgentContext
    agent: StepAgent
    persist: bool = True  # False for /agents/{id}/test: nothing may be written
    run_id: uuid.UUID | None = None
    step_id: str | None = None
    pipeline_id: uuid.UUID | None = None
    pipeline_name: str | None = None
    require_approval: bool = False
    workspace_name: str = ""
    workspace_domain: str | None = None
    logs: list[dict[str, Any]] = field(default_factory=list)
    on_log: Callable[[], Awaitable[None]] | None = None
    counters: dict[str, int] = field(default_factory=lambda: {"content_created": 0})
    is_cancelled: Callable[[], Awaitable[bool]] | None = None
    models_used: list[str] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)
    model_calls: int = 0
    model_tokens: int = 0
    tool_calls: int = 0
    outputs: dict[str, Any] = field(default_factory=dict)

    @property
    def tenant(self) -> TenantSnapshot:
        return self.agent_ctx.tenant

    @property
    def fetcher(self):
        return self.agent_ctx.fetcher

    async def event(self, type: str, message: str, *, level: str = "info", data: dict[str, Any] | None = None) -> None:
        """Execution event for real work in a real run (test runs record nothing)."""
        if self.persist and self.run_id is not None:
            await emit(self.tenant.id, type, message, run_id=self.run_id, step_id=self.step_id, agent_id=self.agent.id,
                       agent_name=self.agent.name, level=level, data=data)

    def note_tool(self, key: str) -> None:
        self.tool_calls += 1
        if key not in self.tools_used:
            self.tools_used.append(key)

    async def audit_side_effect(self, tool_key: str, data: dict[str, Any]) -> None:
        async with session_factory()() as db:
            audit(db, tenant_id=self.tenant.id, actor_type="agent", actor_id=self.agent.name, action=f"tool.{tool_key}",
                  entity="pipeline_run", entity_id=self.run_id, detail=redact({"agent_id": self.agent.id, **data}))
            await db.commit()

    async def log(self, message: str, level: str = "info") -> None:
        message = redact(message)[:2000]
        self.logs.append({"at": iso_now(), "level": level, "message": message})
        if self.on_log is not None:
            await self.on_log()
        await self.event("step.log", message, level=level)

    async def check_cancel(self) -> None:
        if self.is_cancelled is not None and await self.is_cancelled():
            raise RunCancelled("Run cancelled")

    async def generate(
        self,
        *,
        task: str,
        system: str,
        prompt: str,
        schema: type[T],
        context: dict[str, Any] | None = None,
        temperature: float = 0.4,
        max_tokens: int = 1200,
        model: str | None = None,
        validate: Callable[[T], list[str]] | None = None,
        images: list[bytes] | None = None,
    ) -> T:
        """One schema-validated model call (validate + repair loop), logged in model_runs with tokens. When the
        writer model is unavailable and the agent allows it, the call falls back to the fast model."""
        alias = model or self.agent.model
        name = resolve_model(alias, self.tenant.settings)
        fast = resolve_model("fast", self.tenant.settings)
        allow_fallback = bool((self.agent.limits or {}).get("allow_model_fallback", True))

        async def call(model_name: str) -> T:
            if model_name not in self.models_used:
                self.models_used.append(model_name)
            self.model_calls += 1
            started = time.perf_counter()
            obj, model_run_id = await structured(
                self.agent_ctx, agent=f"platform.{self.agent.kind}", task=task, system=system, prompt=prompt, schema=schema,
                context=context, validate=validate, overrides={"model": model_name, "temperature": temperature, "max_tokens": max_tokens},
                images=images,
            )
            tokens = await _tokens(model_run_id)
            self.model_tokens += tokens
            await self.event("model.called", f"{model_name} · {task}",
                             data={"model": model_name, "task": task, "tokens": tokens, "duration_ms": int((time.perf_counter() - started) * 1000)})
            return obj

        try:
            return await call(name)
        except RetryableError as exc:
            if isinstance(exc, AgentOutputError) or not allow_fallback or name == fast:
                raise
            await self.event("model.called", f"{name} unavailable; falling back to {fast}", level="warn",
                             data={"model": name, "task": task, "fallback": fast, "error": str(exc)[:200]})
            return await call(fast)

    async def for_each(
        self, items: list[FlowItem], fn: Callable[[FlowItem], Awaitable[FlowItem | None]], *, label: str
    ) -> list[FlowItem]:
        """Apply `fn` to each item. One bad item is flagged and kept, not fatal; the step fails only when every
        item failed (then something is wrong with the agent, not the data)."""
        out: list[FlowItem] = []
        failures = 0
        for item in items:
            await self.check_cancel()
            await self.agent_ctx.beat()
            try:
                result = await fn(item)
            except (JobError, ValueError) as exc:
                failures += 1
                await self.log(f"{label} failed for '{item.title[:80]}': {str(exc)[:300]}", "warn")
                item.flags.append(f"{self.agent.kind}_failed")
                out.append(item)
                continue
            if result is not None:
                out.append(result)
        if items and failures == len(items):
            raise PermanentError(f"{label} failed for every item")
        return out


async def _tokens(model_run_id: uuid.UUID) -> int:
    from app.models import ModelRun

    async with session_factory()() as db:
        row = (await db.execute(select(ModelRun.prompt_tokens, ModelRun.completion_tokens).where(ModelRun.id == model_run_id))).first()
    return int((row[0] or 0) + (row[1] or 0)) if row else 0


# ---------------------------------------------------------------- kinds registry
def kind_runner(kind: str) -> KindRunner:
    from app.platform.kinds import RUNNERS

    runner = RUNNERS.get(kind)
    if runner is None:
        raise PermanentError(f"No runtime for agent kind '{kind}'")
    return runner


def step_config(agent: Agent, overrides: dict[str, Any] | None) -> dict[str, Any]:
    """Agent config + per-step overrides, re-validated so a stale override cannot break a run silently."""
    merged = {**(agent.config or {}), **(overrides or {})}
    return validate_config(agent.kind, merged)


def step_agent(agent: Agent) -> StepAgent:
    from app.platform.tools import KIND_TOOLS

    return StepAgent(id=str(agent.id), name=agent.name, kind=agent.kind, model=agent.model,
                     tools=list(agent.tools or KIND_TOOLS.get(agent.kind, [])), limits=dict(agent.limits or {}))


# ---------------------------------------------------------------- run creation / resume
STEP_SPEC_KEYS = ("type", "condition", "on_error", "retries", "label", "overrides")


def initial_steps(specs: list[dict[str, Any]], agents: dict[str, Agent]) -> list[dict[str, Any]]:
    """Run step records. The workflow options of each step are snapshotted so editing the pipeline mid-run
    cannot change a run that is already going."""
    steps = []
    for s in specs:
        stype = s.get("type") or "agent"
        agent = agents.get(str(s.get("agent_id"))) if stype == "agent" else None
        steps.append({
            "step_id": s.get("id"),
            "agent_id": str(s.get("agent_id")) if stype == "agent" else None,
            "agent_name": (agent.name if agent else "(deleted agent)") if stype == "agent" else (s.get("label") or "Approval"),
            "kind": (agent.kind if agent else "custom_llm") if stype == "agent" else "approval",
            "status": "pending", "started_at": None, "finished_at": None, "duration_ms": None,
            "items_in": 0, "items_out": 0, "logs": [], "error": None, "attempts": 0,
            **{k: copy.deepcopy(s.get(k)) for k in STEP_SPEC_KEYS},
            "type": stype,
        })
    return steps


async def tenant_agents(db: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Agent]:
    return {str(a.id): a for a in (await db.execute(select(Agent).where(Agent.tenant_id == tenant_id))).scalars()}


def event_row(tenant_id: uuid.UUID, type: str, message: str, *, run_id: uuid.UUID | None = None, **kw: Any) -> ExecutionEvent:
    """An event written in the caller's transaction (API paths must not open a second writer on SQLite)."""
    return ExecutionEvent(tenant_id=tenant_id, run_id=run_id, type=type, message=redact(message), level=kw.get("level", "info"),
                          step_id=kw.get("step_id"), agent_id=kw.get("agent_id"), agent_name=kw.get("agent_name"),
                          data=redact(kw.get("data") or {}))


async def start_run(
    db: AsyncSession,
    pipeline: Pipeline | None = None,
    *,
    agent: Agent | None = None,
    trigger: str,
    input: dict[str, Any] | None = None,
    created_by: uuid.UUID | None = None,
    idempotency_key: str | None = None,
    check_quota: bool = True,
) -> PipelineRun:
    """Create a queued run (pipeline or single agent) and its worker job. Checks the workspace may run (status,
    runs/day). Caller commits."""
    from app.platform.plans import check_can_run

    tenant_id = pipeline.tenant_id if pipeline is not None else agent.tenant_id  # type: ignore[union-attr]
    tenant = await db.get(Tenant, tenant_id)
    if check_quota:
        await check_can_run(db, tenant)
    agents = await tenant_agents(db, tenant_id)
    specs = pipeline.steps if pipeline is not None else [{"id": uuid.uuid4().hex, "agent_id": str(agent.id), "type": "agent"}]  # type: ignore[union-attr]
    run = PipelineRun(
        tenant_id=tenant_id, pipeline_id=pipeline.id if pipeline is not None else None, agent_id=agent.id if agent is not None else None,
        status="queued", trigger=trigger, input=input or None, steps=initial_steps(specs or [], agents), items=[],
        created_by=created_by, idempotency_key=idempotency_key,
    )
    db.add(run)
    await db.flush()
    await enqueue(db, tenant_id=tenant_id, type="pipeline_run", payload={"run_id": str(run.id)}, max_attempts=RUN_JOB_ATTEMPTS,
                  created_by=created_by, dedupe_key=f"run:{run.id}")
    name = pipeline.name if pipeline is not None else agent.name  # type: ignore[union-attr]
    db.add(event_row(tenant_id, "run.queued", f"{name}: queued ({trigger})", run_id=run.id,
                     agent_id=agent.id if agent is not None else None, agent_name=agent.name if agent is not None else None,
                     data={"trigger": trigger, "pipeline_id": str(pipeline.id) if pipeline is not None else None}))
    return run


async def resume_run(db: AsyncSession, run: PipelineRun) -> None:
    """Re-enqueue a run paused for approval; it continues at the paused step. Caller commits."""
    if run.status != "awaiting_approval":
        return
    await enqueue(db, tenant_id=run.tenant_id, type="pipeline_run", payload={"run_id": str(run.id), "resume": True},
                  max_attempts=RUN_JOB_ATTEMPTS, dedupe_key=f"run:{run.id}")


# ---------------------------------------------------------------- conditions
def condition_holds(cond: dict[str, Any] | None, items: list[FlowItem]) -> bool:
    """`items.count` compares the number of items; any other field is true when at least one item matches."""
    if not cond:
        return True
    from app.platform.kinds.data_transform import passes

    field_, op, value = str(cond.get("field") or "items.count"), cond.get("op") or "not_empty", cond.get("value")
    if field_ in ("items", "items.count", "count"):
        n = len(items)
        if op in ("empty", "not_empty", "exists"):
            return (n == 0) if op == "empty" else n > 0
        try:
            target = float(value)
        except (TypeError, ValueError):
            return False
        return {"gt": n > target, "gte": n >= target, "lt": n < target, "lte": n <= target, "eq": n == target, "neq": n != target}.get(op, False)
    if op == "empty":
        return all(not passes(it, {"field": field_, "op": "exists"}, utcnow().date()) for it in items)
    if op == "not_empty":
        op = "exists"
    return any(passes(it, {"field": field_, "op": op, "value": value}, utcnow().date()) for it in items)


# ---------------------------------------------------------------- execution
async def _save(run_id: uuid.UUID, **values: Any) -> None:
    async with session_factory()() as db:
        run = await db.get(PipelineRun, run_id)
        if run is None:
            return
        for k, v in values.items():
            setattr(run, k, v)
        await db.commit()


async def _cancel_requested(run_id: uuid.UUID) -> bool:
    async with session_factory()() as db:
        row = (await db.execute(select(PipelineRun.cancel_requested, PipelineRun.status).where(PipelineRun.id == run_id))).first()
    return bool(row and (row[0] or row[1] == "cancelled"))


async def _agent_status(agent_id: str, error: str | None) -> None:
    async with session_factory()() as db:
        agent = await db.get(Agent, uuid.UUID(agent_id))
        if agent is not None:
            agent.last_error = error[:1000] if error else None
            await db.commit()


def _preview(items: list[FlowItem], limit: int = 10) -> list[dict[str, Any]]:
    out = []
    for it in items[:limit]:
        d = it.state()
        d["text"] = (d.get("text") or "")[:1500]
        out.append(d)
    return out


async def _defer_for_concurrency(db: AsyncSession, run: PipelineRun, tenant: Tenant) -> bool:
    """Fairness: a workspace runs at most `concurrent_runs` at a time; extra runs stay queued and are retried."""
    from app.platform.plans import limits_of

    limit = limits_of(tenant)["concurrent_runs"]
    running = int((await db.execute(select(func.count()).select_from(PipelineRun).where(
        PipelineRun.tenant_id == tenant.id, PipelineRun.status == "running", PipelineRun.id != run.id))).scalar_one())
    if limit < 0 or running < limit:
        return False
    await enqueue(db, tenant_id=tenant.id, type="pipeline_run", payload={"run_id": str(run.id), "deferred": True}, max_attempts=RUN_JOB_ATTEMPTS,
                  available_at=utcnow() + timedelta(seconds=CONCURRENCY_RETRY_S))
    await db.commit()
    return True


async def execute_run(ctx: AgentContext, run_id: uuid.UUID) -> dict[str, Any]:
    """Worker entry point for `pipeline_run` jobs (fresh runs, approval resumes, deferred runs)."""
    async with session_factory()() as db:
        run = await db.get(PipelineRun, run_id)
        if run is None:
            return {"skipped": "run deleted"}
        pipeline = await db.get(Pipeline, run.pipeline_id) if run.pipeline_id else None
        tenant = await db.get(Tenant, run.tenant_id)
        agents = await tenant_agents(db, run.tenant_id)
        status, cancel = run.status, run.cancel_requested
        if status not in ("queued", "awaiting_approval", "running") or (run.pipeline_id and pipeline is None):
            return {"skipped": f"run is {status}"}
        if not cancel and status != "awaiting_approval" and await _defer_for_concurrency(db, run, tenant):
            return {"deferred": "concurrency limit"}
        steps = copy.deepcopy(run.steps or [])
        resume_at = run.resume_step
        items = [FlowItem.from_dict(i) for i in run.items or []] if resume_at is not None else items_from_input(run.input)
        counters = {"content_created": run.content_created or 0}
        started_at = run.started_at
    tid = run.tenant_id
    name = pipeline.name if pipeline is not None else (agents.get(str(run.agent_id)).name if run.agent_id and agents.get(str(run.agent_id)) else "Agent run")
    require_approval = pipeline.require_approval if pipeline is not None else False
    if cancel:
        await _save(run_id, status="cancelled", finished_at=utcnow())
        await emit(tid, "run.cancelled", f"{name}: cancelled", run_id=run_id)
        return {"status": "cancelled"}

    await _save(run_id, status="running", started_at=started_at or utcnow(), error=None)
    await emit(tid, "run.started", f"{name}: {'resumed' if resume_at is not None else 'started'}", run_id=run_id,
               data={"steps": len(steps), "items": len(items), "resumed": resume_at is not None})

    async def finish_cancelled(i: int) -> dict[str, Any]:
        for s in steps[i:]:
            if s["status"] in ("pending", "running"):
                s["status"] = "skipped"
        await _save(run_id, status="cancelled", steps=copy.deepcopy(steps), finished_at=utcnow(), content_created=counters["content_created"])
        await emit(tid, "run.cancelled", f"{name}: cancelled", run_id=run_id)
        return {"status": "cancelled"}

    async def pause(i: int, message: str, *, step_status: str = "pending") -> dict[str, Any]:
        step = steps[i]
        step.update(status=step_status)
        step["logs"].append({"at": iso_now(), "level": "info", "message": message})
        await _save(run_id, status="awaiting_approval", steps=copy.deepcopy(steps), items=[it.state() for it in items], resume_step=i,
                    content_created=counters["content_created"])
        await emit(tid, "run.awaiting_approval", message, run_id=run_id, step_id=step.get("step_id"), agent_id=step.get("agent_id"),
                   agent_name=step.get("agent_name"))
        await notify(tid, "approval_needed", f"{name} is waiting for approval", message, f"/runs/{run_id}")
        await _audit(tid, run_id, "run.awaiting_approval", name, message)
        return {"status": "awaiting_approval"}

    for i in range(resume_at or 0, len(steps)):
        step = steps[i]
        if await _cancel_requested(run_id):
            return await finish_cancelled(i)
        sid, stype = step.get("step_id"), step.get("type") or "agent"

        if stype == "approval":
            if not step.get("approved"):
                return await pause(i, step.get("label") or "Waiting for a human to approve this run")
            step.update(status="succeeded", finished_at=step.get("finished_at") or iso_now(), items_in=len(items), items_out=len(items))
            await _save(run_id, steps=copy.deepcopy(steps))
            continue

        agent = agents.get(step.get("agent_id") or "")
        reason = None
        if agent is None:
            reason = "Agent was deleted"
        elif agent.status != "active":
            reason = f"Agent is {agent.status}"
        elif not condition_holds(step.get("condition"), items):
            c = step["condition"]
            reason = f"Condition not met ({c.get('field')} {c.get('op')} {c.get('value', '')})".strip()
        if reason:
            step.update(status="skipped", finished_at=iso_now(), items_in=len(items), items_out=len(items), error=None)
            step["logs"].append({"at": iso_now(), "level": "info", "message": f"Skipped: {reason}"})
            await _save(run_id, steps=copy.deepcopy(steps))
            await emit(tid, "step.skipped", f"{step['agent_name']}: skipped ({reason})", run_id=run_id, step_id=sid,
                       agent_id=step.get("agent_id"), agent_name=step.get("agent_name"), data={"reason": reason})
            continue
        if agent.requires_approval and agent.kind in SIDE_EFFECT_KINDS and not step.get("approved"):
            return await pause(i, f"{agent.name} acts outside LayerFlow and needs approval before it runs")

        limits = agent.limits or {}
        max_items = int(limits.get("max_items") or 0)
        step_items = items[:max_items] if max_items > 0 else items
        on_error = step.get("on_error") or "stop"
        retries = min(3, int(step.get("retries") or limits.get("max_retries") or 1)) if on_error == "retry" else 0
        if i == resume_at:
            step["logs"].append({"at": iso_now(), "level": "info", "message": "Resumed after approval"})

        async def persist_logs() -> None:
            await _save(run_id, steps=copy.deepcopy(steps))

        rctx = RunContext(
            agent_ctx=ctx, agent=step_agent(agent), run_id=run_id, step_id=sid,
            pipeline_id=pipeline.id if pipeline is not None else None, pipeline_name=pipeline.name if pipeline is not None else None,
            require_approval=require_approval, workspace_name=tenant.name if tenant else "", workspace_domain=tenant.domain if tenant else None,
            logs=step["logs"], on_log=persist_logs, counters=counters, is_cancelled=lambda: _cancel_requested(run_id),
        )
        attempt = 0
        while True:
            attempt += 1
            step.update(status="running", started_at=step["started_at"] or iso_now(), error=None, items_in=len(step_items),
                        attempts=int(step.get("attempts") or 0) + 1)
            await _save(run_id, status="running", steps=copy.deepcopy(steps))
            await emit(tid, "step.started", f"{agent.name}: started with {len(step_items)} item(s)", run_id=run_id, step_id=sid,
                       agent_id=agent.id, agent_name=agent.name, data={"items": len(step_items), "attempt": attempt})
            t0 = time.perf_counter()
            try:
                config = step_config(agent, step.get("overrides"))
                out = await asyncio.wait_for(kind_runner(agent.kind)(rctx, config, step_items),
                                             timeout=int(limits.get("timeout_s") or DEFAULT_TIMEOUT_S))
            except AwaitingApproval as exc:
                step["tools_used"], step["model_calls"] = rctx.tools_used, rctx.model_calls
                return await pause(i, f"Waiting for approval: {exc.pending} content item(s) need review in Content")
            except RunCancelled:
                step.update(status="skipped", finished_at=iso_now())
                return await finish_cancelled(i + 1)
            except Exception as exc:  # any failure is shown on the step; the policy decides what happens next
                if isinstance(exc, TimeoutError):
                    exc = PermanentError(f"Timed out after {int(limits.get('timeout_s') or DEFAULT_TIMEOUT_S)}s")
                message = "; ".join(exc.problems) if isinstance(exc, ConfigError) else (str(exc) or exc.__class__.__name__)
                message = redact(message)
                if attempt <= retries:
                    step["logs"].append({"at": iso_now(), "level": "warn", "message": f"Attempt {attempt} failed: {message[:300]}; retrying"})
                    await emit(tid, "run.retrying", f"{agent.name}: attempt {attempt} failed, retrying", run_id=run_id, step_id=sid,
                               agent_id=agent.id, agent_name=agent.name, level="warn", data={"error": message[:300], "attempt": attempt})
                    await asyncio.sleep(min(5, attempt))
                    continue
                now = utcnow()
                step.update(status="failed", finished_at=now.isoformat(), duration_ms=int((time.perf_counter() - t0) * 1000),
                            error=message[:1000], tools_used=rctx.tools_used, model_calls=rctx.model_calls, model_tokens=rctx.model_tokens,
                            tool_calls=rctx.tool_calls)
                step["logs"].append({"at": now.isoformat(), "level": "error", "message": message[:1000]})
                await emit(tid, "step.failed", f"{agent.name}: {message[:300]}", run_id=run_id, step_id=sid, agent_id=agent.id,
                           agent_name=agent.name, level="error", data={"error": message[:500]})
                await _agent_status(str(agent.id), message)
                if on_error == "continue":
                    await _save(run_id, steps=copy.deepcopy(steps))
                    break
                for s in steps[i + 1 :]:
                    s["status"] = "skipped"
                await _save(run_id, status="failed", steps=copy.deepcopy(steps), finished_at=now, error=f"{agent.name}: {message}"[:2000],
                            items=[it.state() for it in items], content_created=counters["content_created"], resume_step=None)
                await emit(tid, "run.failed", f"{name} failed at {agent.name}: {message[:200]}", run_id=run_id, level="error")
                await notify(tid, "run_failed", f"{name} failed", f"{agent.name}: {message[:300]}", f"/runs/{run_id}")
                await _audit(tid, run_id, "run.failed", name, f"{agent.name}: {message[:200]}", error=True)
                raise PermanentError(f"Run '{name}' failed at {agent.name}: {message[:300]}") from exc
            ms = int((time.perf_counter() - t0) * 1000)
            step.update(status="succeeded", finished_at=iso_now(), duration_ms=ms, items_out=len(out), tools_used=rctx.tools_used,
                        model_calls=rctx.model_calls, model_tokens=rctx.model_tokens, tool_calls=rctx.tool_calls, output=_preview(out),
                        outputs={"content_ids": rctx.outputs.get("content_ids") or [i_.content_id for i_ in out if i_.content_id],
                                 "dataset_changes": rctx.outputs.get("dataset_changes"), "report": rctx.outputs.get("report")})
            items = out
            await _save(run_id, steps=copy.deepcopy(steps), items=[it.state() for it in items], content_created=counters["content_created"])
            await emit(tid, "step.finished", f"{agent.name}: {len(out)} item(s) out in {ms} ms", run_id=run_id, step_id=sid,
                       agent_id=agent.id, agent_name=agent.name, data={"items_in": len(step_items), "items_out": len(out), "duration_ms": ms,
                                                                        "tools": rctx.tools_used, "model_calls": rctx.model_calls})
            if agent.last_error:
                await _agent_status(str(agent.id), None)
            break

    await _save(run_id, status="succeeded", finished_at=utcnow(), items_out=len(items), resume_step=None,
                items=[it.state() for it in items], content_created=counters["content_created"])
    await emit(tid, "run.finished", f"{name}: finished, {len(items)} item(s), {counters['content_created']} content", run_id=run_id,
               data={"items_out": len(items), "content_created": counters["content_created"]})
    await _audit(tid, run_id, "run.succeeded", name, f"{len(items)} item(s), {counters['content_created']} content created")
    return {"status": "succeeded", "items_out": len(items), "content_created": counters["content_created"]}


async def _audit(tenant_id: uuid.UUID, run_id: uuid.UUID, action: str, pipeline_name: str, message: str, *, error: bool = False) -> None:
    async with session_factory()() as db:
        audit(db, tenant_id=tenant_id, actor_type="agent", actor_id="pipeline", action=action, entity="pipeline_run",
              entity_id=run_id, detail={"pipeline": pipeline_name, "message": message, "error": error})
        await db.commit()


# ---------------------------------------------------------------- inline test
async def run_agent_inline(
    tenant: Tenant,
    agent: Agent,
    *,
    input: dict[str, Any] | None,
    config_override: dict[str, Any] | None,
) -> dict[str, Any]:
    """POST /agents/{id}/test: run one agent once on the given input. Nothing is persisted (content, records and
    side effects are dry runs); model calls are still recorded in model_runs for transparency."""
    from app.platform.net import new_fetcher
    from app.providers.registry import get_provider

    started = time.perf_counter()
    fetcher = new_fetcher()
    rctx = RunContext(
        agent_ctx=AgentContext(tenant=TenantSnapshot.of(tenant), provider=get_provider(), fetcher=fetcher),
        agent=step_agent(agent),
        persist=False,
        workspace_name=tenant.name,
        workspace_domain=tenant.domain,
    )
    items: list[FlowItem] = []
    error = None
    try:
        config = validate_config(agent.kind, {**(agent.config or {}), **(config_override or {})})
        items = await kind_runner(agent.kind)(rctx, config, items_from_input(input))
    except ConfigError as exc:
        error = "; ".join(exc.problems)
    except AwaitingApproval as exc:
        error = str(exc)
    except Exception as exc:  # surfaced to the user as the test result
        error = str(exc) or exc.__class__.__name__
    finally:
        await fetcher.close()
    if error:
        await rctx.log(error, "error")
    return {
        "ok": error is None,
        "duration_ms": int((time.perf_counter() - started) * 1000),
        "items": [it.out() for it in items],
        "logs": rctx.logs,
        "error": error,
        "model": rctx.models_used[-1] if rctx.models_used else (
            resolve_model(agent.model, TenantSnapshot.of(tenant).settings) if AGENT_KINDS[agent.kind].uses_model else None),
    }


def _ms(start: datetime | None, end: datetime | None) -> int | None:
    return int((end - start).total_seconds() * 1000) if start and end else None
