"""comparison_assistant as a pipeline step: each item's text is a question (e.g. a form submission arriving on
the webhook trigger); the answer and the compared record keys are written into item.data."""

from __future__ import annotations

from typing import Any

from app.core.db import session_factory
from app.models import Tenant
from app.platform.assistant import chat
from app.platform.flow import FlowItem
from app.platform.kinds.dataset_builder import load_dataset


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    ds = await load_dataset(ctx, cfg["dataset"])

    async def answer(item: FlowItem) -> FlowItem:
        question = str(item.data.get("question") or item.text or item.title)
        async with session_factory()() as db:
            tenant = await db.get(Tenant, ctx.tenant.id)
            res = await chat(db, tenant, ds, message=question, config=cfg, model=ctx.agent.model, agent_name=ctx.agent.name)
        item.data["answer"] = res["answer"]
        item.data["compared"] = [r["key"] for r in res["records"]]
        item.data["winners"] = (res["table"] or {}).get("winners", {})
        item.data["sources"] = res.get("sources", [])
        return item

    out = await ctx.for_each(items, answer, label="Assistant")
    await ctx.log(f"Answered {len(out)} question(s) from '{ds.name}'")
    return out
