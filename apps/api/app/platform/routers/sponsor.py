"""LiveDesk: one request, both sponsors.

A research run fans out to the selected SerpApi engines and the You.com Answer API in parallel, then returns
normalised results plus the numbered citations that make the answer verifiable. No API key ever comes from the
request; when a key is absent the sponsor service returns clearly-labelled sample data (``provider='demo'``).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal, current_principal, get_db, require
from app.platform.livedesk import persist_research
from app.platform.schemas import LiveDeskResearch
from app.services import sponsor

router = APIRouter(tags=["livedesk"])
log = logging.getLogger(__name__)

ENGINE_LABELS = sponsor.ENGINE_LABELS


@router.get("/livedesk/status")
async def livedesk_status(principal: Principal = Depends(current_principal)) -> dict[str, Any]:
    return {
        "keys": {"serpapi": bool(sponsor.serpapi_key()), "youcom": bool(sponsor.youcom_key())},
        "mode": "live" if sponsor.serpapi_key() and sponsor.youcom_key() else "demo",
        "engines": [{"key": k, "label": v} for k, v in ENGINE_LABELS.items()],
    }


@router.post("/livedesk/research")
async def livedesk_research(
    body: LiveDeskResearch,
    principal: Principal = Depends(require("agents.run")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    started = time.perf_counter()
    query = body.query.strip()
    engines = list(dict.fromkeys(body.engines)) or ["google"]
    location = (body.location or "").strip()

    async def collect(engine: str) -> dict[str, Any]:
        hits = await sponsor.serpapi_search(query, engine=engine, location=location, count=body.count)
        return {
            "engine": engine,
            "label": ENGINE_LABELS.get(engine, engine),
            "provider": hits[0].provider if hits else "demo",
            "degraded": not hits or all(h.provider == "demo" for h in hits),
            "hits": [h.out() for h in hits],
        }

    collections, answer = await asyncio.gather(
        asyncio.gather(*(collect(e) for e in engines)),
        sponsor.you_answer(query),
    )

    # Reuse the answer's own web results: no second You.com call, no extra credits. Some You.com answers
    # carry results.web[] without numbered citations — promote those hits to links so no answer is unsourced.
    citations = answer.citations
    if not citations and answer.results:
        citations = [
            {
                "number": h.position or i,
                "title": h.title,
                "source": h.url,
                "excerpt": h.summary,
                "provider": h.provider,
            }
            for i, h in enumerate(answer.results, 1)
        ]
        answer.citations = citations
    evidence_lines = [
        f"[{c.get('number', i)}] {c.get('title', '')} — {str(c.get('excerpt', ''))[:280]} ({c.get('source', '')})"
        for i, c in enumerate(citations, 1)
    ]
    if not evidence_lines:
        evidence_lines = [
            f"[{h.position or i}] {h.title} — {h.summary[:280]} ({h.url})"
            for i, h in enumerate(answer.results, 1)
        ]
    result = {
        "query": query,
        "answer": answer.out(),
        "collections": list(collections),
        "evidence": "\n".join(evidence_lines),
        "sources": citations,
        "keys": {"serpapi": bool(sponsor.serpapi_key()), "youcom": bool(sponsor.youcom_key())},
        "degraded": answer.degraded or any(c["degraded"] for c in collections),
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }

    # A paid-for sponsor answer must never be lost because of a storage hiccup. Save it as an
    # agent run + dataset record so the assistant, activity feed and audit trail all see the same evidence.
    try:
        result.update(await persist_research(
            db,
            tenant_id=principal.tenant_id,
            user_id=principal.user.id,
            query=query,
            engines=engines,
            result=result,
            latency_ms=result["latency_ms"],
            location=location,
            count=body.count,
        ))
        await db.commit()
    except Exception:  # pragma: no cover - defensive: never fail a successful research call
        await db.rollback()
        log.exception("livedesk research result could not be persisted")

    return result
