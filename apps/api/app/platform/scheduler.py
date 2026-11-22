"""Scheduled work: the worker's scheduler tick starts every enabled `schedule` pipeline and every active agent
with a schedule whose `next_run_at` has passed. Something that still has a queued/running run is not started
again (no pile-up when a run outlasts its interval); its next slot simply moves on. Paused agents are skipped.
A workspace over its quota (or suspended) gets a notification instead of a run."""

from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import ApiError
from app.models import Agent, Notification, Pipeline, PipelineRun
from app.platform.runtime import start_run


async def _busy(db: AsyncSession, **where: uuid.UUID) -> bool:
    stmt = select(PipelineRun.id).where(PipelineRun.status.in_(("queued", "running")))
    for k, v in where.items():
        stmt = stmt.where(getattr(PipelineRun, k) == v)
    return (await db.execute(stmt.limit(1))).scalar_one_or_none() is not None


async def tick_pipelines(db: AsyncSession) -> int:
    now = utcnow()
    started = 0
    due = (await db.execute(select(Pipeline).where(
        Pipeline.trigger_type == "schedule", Pipeline.enabled.is_(True), Pipeline.next_run_at.is_not(None), Pipeline.next_run_at <= now
    ))).scalars().all()
    agents = (await db.execute(select(Agent).where(
        Agent.status == "active", Agent.every_minutes.is_not(None), Agent.next_run_at.is_not(None), Agent.next_run_at <= now
    ))).scalars().all()
    targets: list[Pipeline | Agent] = [*due, *agents]
    for target in targets:
        target.next_run_at = now + timedelta(minutes=max(5, int(target.every_minutes or 60)))
        is_pipe = isinstance(target, Pipeline)
        if await _busy(db, **({"pipeline_id": target.id} if is_pipe else {"agent_id": target.id})):
            continue
        try:
            if is_pipe:
                await start_run(db, target, trigger="schedule")
            else:
                await start_run(db, agent=target, trigger="schedule")
            started += 1
        except ApiError as exc:  # quota exceeded / workspace suspended: tell the workspace, skip this slot
            db.add(Notification(tenant_id=target.tenant_id, kind="quota", title=f"Scheduled run of {target.name} skipped",
                                body=exc.message, link="/usage"))
    if due or agents:
        await db.commit()
    return started
