"""Turn a LiveDesk research response into reusable platform state.

A LiveDesk run is not a one-off widget call: it is an agent execution. We record a pipeline run with one step
per agent in the LiveDesk desk, upsert the answer as a real research dataset record (so the assistant can
follow up on it), and write the same run/step events the normal runtime writes. Sponsor keys and full answer
text never go into logs or audit details.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import utcnow
from app.models import Agent, Dataset, Pipeline, PipelineRun
from app.platform.datasets import upsert_record
from app.platform.runtime import event_row, initial_steps

DESK_DATASET = "research_queue"
DESK_PIPELINE = "Daily live research"


async def _desk_agents(db: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Agent]:
    return {str(a.id): a for a in (await db.execute(select(Agent).where(Agent.tenant_id == tenant_id))).scalars()}


def _step_outputs(agent_kind: str, *, hits: int, citations: int) -> int:
    if agent_kind in ("you_research", "comparison_assistant"):
        return citations or hits
    return hits


async def persist_research(
    db: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID | None,
    query: str,
    engines: list[str],
    result: dict[str, Any],
    latency_ms: int,
    location: str = "",
    count: int = 5,
) -> dict[str, Any]:
    """Write the run, record and events. Returns ids for the UI to link to.

    Persistence is best-effort by design: a sponsor answer is still valuable if a dataset was deleted. Callers
    catch storage errors and log them rather than throwing away a successful (and already paid-for) research
    result.
    """
    collections = result.get("collections") or []
    citations = result.get("sources") or []
    answer = result.get("answer") or {}
    total_hits = sum(len(c.get("hits") or []) for c in collections if isinstance(c, dict))
    now = utcnow()
    started = now - timedelta(milliseconds=max(0, latency_ms))

    pipeline = (
        await db.execute(select(Pipeline).where(Pipeline.tenant_id == tenant_id, Pipeline.name == DESK_PIPELINE))
    ).scalar_one_or_none()
    agents = await _desk_agents(db, tenant_id)
    specs = pipeline.steps or [] if pipeline is not None else []
    steps = initial_steps(specs, agents) if specs else []
    if not steps:
        researcher = next((a for a in agents.values() if a.kind == "researcher"), None)
        steps = [{
            "step_id": "livedesk-research",
            "agent_id": str(researcher.id) if researcher else None,
            "agent_name": researcher.name if researcher else "LiveDesk researcher",
            "kind": researcher.kind if researcher else "researcher",
            "status": "pending", "started_at": None, "finished_at": None, "duration_ms": None,
            "items_in": 0, "items_out": 0, "logs": [], "error": None, "attempts": 0, "type": "agent",
        }]

    for step in steps:
        produced = _step_outputs(step.get("kind") or "", hits=total_hits, citations=len(citations))
        step.update(
            status="succeeded",
            started_at=started.isoformat(),
            finished_at=now.isoformat(),
            duration_ms=max(0, latency_ms),
            items_in=total_hits,
            items_out=produced,
            logs=[f"Live evidence: {total_hits} structured hits, {len(citations)} cited sources"],
            error=None,
        )

    run = PipelineRun(
        tenant_id=tenant_id,
        pipeline_id=pipeline.id if pipeline is not None else None,
        agent_id=next((s["agent_id"] for s in steps if s.get("agent_id")), None),
        trigger="manual",
        status="succeeded",
        input={"question": query, "engines": engines, "location": location, "per_engine": count, "desk": "livedesk"},
        steps=steps,
        items=[],
        items_out=total_hits + len(citations),
        created_by=user_id,
        started_at=started,
        finished_at=now,
    )
    db.add(run)
    await db.flush()

    ds = (
        await db.execute(select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.slug == DESK_DATASET))
    ).scalar_one_or_none()
    record = None
    if ds is not None:
        key_field = ds.key_field or "question"
        data: dict[str, Any] = {
            key_field: query,
            "question": query,
            "topic": "Live research",
            "status": "answered",
            "priority": 5,
            "notes": (
                f"Live answer from You.com with {len(citations)} citations; "
                f"{total_hits} structured SerpApi hits across {', '.join(engines)} in {latency_ms} ms."
            ),
            "answer": str(answer.get("answer") or "")[:4000],
            "provider": answer.get("provider"),
            "engines": engines,
            "citations": [c.get("source") for c in citations if isinstance(c, dict) and c.get("source")][:8],
            "total_hits": total_hits,
            "latency_ms": latency_ms,
            "run_id": str(run.id),
        }
        _, record = await upsert_record(
            db, ds, data, source_url=(citations[0].get("source") if citations and isinstance(citations[0], dict) else None)
        )

    for step in steps:
        db.add(event_row(
            tenant_id, "step.finished", f"{step.get('agent_name')} finished LiveDesk research",
            run_id=run.id, step_id=step.get("step_id"), agent_id=step.get("agent_id"),
            agent_name=step.get("agent_name"),
            data={"items_in": step["items_in"], "items_out": step["items_out"], "duration_ms": latency_ms},
        ))
    db.add(event_row(
        tenant_id, "run.finished", f"Daily live research: {query[:120]}",
        run_id=run.id, data={"items_out": run.items_out, "content_created": 0},
    ))
    audit(
        db, tenant_id=tenant_id, actor_type="user", actor_id=user_id,
        action="livedesk.research", entity="run", entity_id=run.id,
        detail={"question": query[:200], "engines": engines, "hits": total_hits, "citations": len(citations)},
    )
    return {
        "run_id": str(run.id),
        "record_id": str(record.id) if record is not None else None,
        "saved": True,
    }
