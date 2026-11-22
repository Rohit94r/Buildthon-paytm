"""Public API (`/api/public/v1`) for client websites and the embed widget. Auth is a workspace API key
(`Authorization: Bearer lf_pk_…`, `X-API-Key`, or `?key=` for the widget/RSS); every key carries scopes and a
per-key rate limit. CORS is open on this prefix only (see app/main.py)."""

from __future__ import annotations

import json
import time
import uuid
from email.utils import format_datetime
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.deps import client_ip, get_db
from app.core.errors import ApiError, not_found
from app.core.ratelimit import limiter
from app.core.security import constant_time_equals, decrypt_secret, hash_token
from app.models import Agent, ApiKey, ContentItem, Dataset, DatasetRecord, Pipeline, PipelineRun, Tenant
from app.platform.assistant import resolve_dataset
from app.platform.content import primary_format
from app.platform.datasets import query_records, record_counts
from app.platform.plans import count_api_call
from app.platform.routers.datasets import answer_chat
from app.platform.runtime import start_run
from app.platform.schemas import ChatRequest, PublicRunRequest
from app.platform.serializers import dataset_out, public_content_out, public_run_out, record_out

router = APIRouter(prefix="/api/public/v1", tags=["public"])
CACHE = "public, max-age=30, s-maxage=60"
MAX_PUBLISHED_SCAN = 2000


class KeyContext:
    def __init__(self, key: ApiKey, tenant: Tenant) -> None:
        self.key = key
        self.tenant = tenant


def _secret_from(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.headers.get("x-api-key") or request.query_params.get("key")


def require_scope(scope: str):
    async def _dep(request: Request, db: AsyncSession = Depends(get_db)) -> KeyContext:
        secret = _secret_from(request)
        if not secret:
            raise ApiError(401, "api_key_required", "Pass an API key: Authorization: Bearer lf_pk_…")
        key = (await db.execute(select(ApiKey).where(ApiKey.secret_hash == hash_token(secret)))).scalar_one_or_none()
        if key is None:
            raise ApiError(401, "invalid_api_key", "Unknown API key")
        if key.revoked_at is not None:
            raise ApiError(401, "api_key_revoked", "This API key has been revoked")
        if scope not in (key.scopes or []):
            raise ApiError(403, "insufficient_scope", f"This key lacks the '{scope}' scope")
        allowed, retry = limiter.hit(f"pub:{key.id}", get_settings().public_api_rate_per_min, 60)
        if not allowed:
            raise ApiError(429, "rate_limited", "Too many requests for this API key", {"retry_after_s": round(retry, 1)})
        if key.last_used_at is None or (utcnow() - key.last_used_at).total_seconds() > 60:
            key.last_used_at = utcnow()
        tenant = await db.get(Tenant, key.tenant_id)
        await db.commit()
        if tenant.status == "suspended":
            raise ApiError(423, "workspace_suspended", "This workspace is suspended")
        await count_api_call(tenant)
        return KeyContext(key, tenant)

    return _dep


async def _published(db: AsyncSession, tenant_id: uuid.UUID) -> list[ContentItem]:
    return list((await db.execute(
        select(ContentItem).where(ContentItem.tenant_id == tenant_id, ContentItem.status == "published")
        .order_by(ContentItem.published_at.desc()).limit(MAX_PUBLISHED_SCAN)
    )).scalars())


def _has_format(c: ContentItem, fmt: str) -> bool:
    formats = {v.get("format") for v in c.variants or []}
    return fmt in formats or (fmt == "article" and "blog_post" in formats)


@router.get("/content")
async def public_content(
    response: Response,
    format: str = "article",
    tag: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    kc: KeyContext = Depends(require_scope("content:read")),
    db: AsyncSession = Depends(get_db),
):
    rows = [c for c in await _published(db, kc.tenant.id) if _has_format(c, format)
            and (not tag or tag.lower() in {t.lower() for t in c.tags or []})]
    response.headers["Cache-Control"] = CACHE
    return {"items": [public_content_out(c, format) for c in rows[offset : offset + limit]], "total": len(rows)}


@router.get("/content/{slug}")
async def public_content_item(
    slug: str, response: Response, format: str = "article",
    kc: KeyContext = Depends(require_scope("content:read")), db: AsyncSession = Depends(get_db),
):
    c = (await db.execute(select(ContentItem).where(
        ContentItem.tenant_id == kc.tenant.id, ContentItem.slug == slug, ContentItem.status == "published"))).scalar_one_or_none()
    if c is None:
        raise not_found("content")
    response.headers["Cache-Control"] = CACHE
    return public_content_out(c, format)


@router.get("/rss.xml")
async def rss(kc: KeyContext = Depends(require_scope("content:read")), db: AsyncSession = Depends(get_db)):
    t = kc.tenant
    site = f"https://{t.domain}" if t.domain else get_settings().app_base_url
    items = []
    for c in (await _published(db, t.id))[:50]:
        link = next((p.get("url") for p in c.publications or [] if p.get("url") and p.get("kind") in ("nextjs", "wordpress", "ghost")), None) \
            or (f"{site.rstrip('/')}/{c.slug}" if t.domain else c.source_url) or site
        fmt = primary_format(c, "article")
        body = public_content_out(c, fmt)["body_html"]
        items.append(
            "<item>"
            f"<title>{escape(c.title)}</title><link>{escape(link)}</link>"
            f'<guid isPermaLink="false">{c.id}</guid>'
            f"<pubDate>{format_datetime(c.published_at or c.created_at)}</pubDate>"
            f"<description>{escape(c.summary or '')}</description>"
            f"<content:encoded><![CDATA[{body.replace(']]>', ']]&gt;')}]]></content:encoded>"
            + "".join(f"<category>{escape(tag)}</category>" for tag in c.tags or [])
            + "</item>"
        )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>'
        f"<title>{escape(t.name)}</title><link>{escape(site)}</link><description>{escape(t.name)} — latest</description>"
        f"<lastBuildDate>{format_datetime(utcnow())}</lastBuildDate>" + "".join(items) + "</channel></rss>"
    )
    return Response(xml, media_type="application/rss+xml", headers={"Cache-Control": CACHE})


async def _public_dataset(db: AsyncSession, tenant_id: uuid.UUID, slug: str) -> Dataset:
    ds = (await db.execute(select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.slug == slug))).scalar_one_or_none()
    if ds is None or not ds.public:
        raise not_found("dataset")
    return ds


@router.get("/datasets/{slug}/records")
async def public_records(
    slug: str, response: Response, q: str | None = None, sort: str | None = None,
    limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
    kc: KeyContext = Depends(require_scope("datasets:read")), db: AsyncSession = Depends(get_db),
):
    ds = await _public_dataset(db, kc.tenant.id, slug)
    rows, total = await query_records(db, ds, q=q, sort=sort, limit=limit, offset=offset)
    response.headers["Cache-Control"] = CACHE
    return {"dataset": dataset_out(ds, (await record_counts(db, [ds.id])).get(ds.id, 0)), "items": [record_out(r) for r in rows], "total": total}


@router.get("/datasets/{slug}/records/{key}")
async def public_record(
    slug: str, key: str, response: Response,
    kc: KeyContext = Depends(require_scope("datasets:read")), db: AsyncSession = Depends(get_db),
):
    ds = await _public_dataset(db, kc.tenant.id, slug)
    row = (await db.execute(select(DatasetRecord).where(DatasetRecord.dataset_id == ds.id, DatasetRecord.key == key))).scalar_one_or_none()
    if row is None:
        raise not_found("record")
    response.headers["Cache-Control"] = CACHE
    return record_out(row)


@router.post("/chat")
async def public_chat(
    body: ChatRequest, request: Request,
    kc: KeyContext = Depends(require_scope("assistant:chat")), db: AsyncSession = Depends(get_db),
):
    allowed, retry = limiter.hit(f"pubchat:{kc.key.id}:{client_ip(request)}", get_settings().public_chat_rate_per_min, 60)
    if not allowed:
        raise ApiError(429, "rate_limited", "Too many questions; wait a moment", {"retry_after_s": round(retry, 1)})
    if body.dataset and not body.assistant_id:
        # Without an assistant, visitors may only query datasets marked public.
        ds = await resolve_dataset(db, kc.tenant.id, body.dataset)
        if ds is None or not ds.public:
            raise not_found("dataset")
    return await answer_chat(db, kc.tenant, body)


@router.post("/hooks/pipelines/{pipeline_id}")
async def pipeline_hook(pipeline_id: str, request: Request, token: str = "", db: AsyncSession = Depends(get_db)):
    """Run a pipeline from outside (form submit, cron, Zapier). The pipeline's secret token is the auth; the
    JSON or form body becomes the run's input item."""
    try:
        p = await db.get(Pipeline, uuid.UUID(pipeline_id))
    except ValueError:
        p = None
    stored = decrypt_secret(p.webhook_token_enc) if p is not None and p.webhook_token_enc else None
    if p is None or not token or not stored or not constant_time_equals(stored, token):
        raise ApiError(401, "invalid_token", "Unknown pipeline or wrong token")
    if p.trigger_type != "webhook":
        raise ApiError(409, "webhook_disabled", "This pipeline is not triggered by webhook")
    if not p.enabled:
        raise ApiError(409, "pipeline_disabled", "This pipeline is disabled")
    allowed, retry = limiter.hit(f"hook:{p.id}", 30, 60)
    if not allowed:
        raise ApiError(429, "rate_limited", "Too many webhook calls", {"retry_after_s": round(retry, 1)})
    payload: dict = {}
    ctype = request.headers.get("content-type", "")
    raw = await request.body()
    if raw:
        if "json" in ctype or raw.lstrip()[:1] in (b"{", b"["):
            try:
                parsed = json.loads(raw)
            except ValueError as exc:
                raise ApiError(400, "invalid_json", "Body is not valid JSON") from exc
            payload = parsed if isinstance(parsed, dict) else {"items": parsed}
        else:
            payload = {k: v for k, v in (await request.form()).items() if isinstance(v, str)}
    if isinstance(payload.get("items"), list):
        run_input = {"items": [i for i in payload["items"] if isinstance(i, dict)][:100]}
    elif payload:
        run_input = {"items": [{
            "title": str(payload.get("title") or payload.get("name") or payload.get("subject") or "Webhook submission")[:300],
            "text": str(payload.get("text") or payload.get("message") or payload.get("body") or json.dumps(payload, ensure_ascii=False))[:50_000],
            "url": payload.get("url") if isinstance(payload.get("url"), str) else None,
            "data": payload,
        }]}
    else:
        run_input = None
    run = await start_run(db, p, trigger="webhook", input=run_input)
    await db.commit()
    return {"run_id": str(run.id)}


# ---------------------------------------------------------------- external execution (API.md §8)
IDEMPOTENCY_HOURS = 24
WAIT_MAX_S = 25.0
TERMINAL = ("succeeded", "failed", "cancelled", "awaiting_approval")


async def _public_run(db: AsyncSession, run: PipelineRun) -> dict:
    wf = await db.get(Pipeline, run.pipeline_id) if run.pipeline_id else None
    ag = await db.get(Agent, run.agent_id) if run.agent_id else None
    return public_run_out(run, workflow=wf, agent=ag)


async def _start_public(request: Request, db: AsyncSession, kc: KeyContext, body: PublicRunRequest, *, pipeline: Pipeline | None,
                        agent: Agent | None) -> dict:
    from datetime import timedelta

    from app.core.audit import audit

    idem = (request.headers.get("idempotency-key") or "").strip()[:128] or None
    if idem:
        prior = (await db.execute(select(PipelineRun).where(
            PipelineRun.tenant_id == kc.tenant.id, PipelineRun.idempotency_key == idem,
            PipelineRun.created_at >= utcnow() - timedelta(hours=IDEMPOTENCY_HOURS)).order_by(PipelineRun.created_at).limit(1))).scalar_one_or_none()
        if prior is not None:
            return await _public_run(db, prior)
    inp = body.input.model_dump(exclude_none=True) if body.input else None
    if inp and inp.get("data") and not inp.get("items") and not inp.get("text"):
        inp = {"items": [{"title": str(inp["data"].get("title") or inp["data"].get("name") or "API input")[:300], "data": inp["data"],
                          "text": str(inp["data"].get("text") or inp["data"].get("message") or "")}]}
    run = await start_run(db, pipeline, agent=agent, trigger="api", input=inp, idempotency_key=idem)
    audit(db, tenant_id=kc.tenant.id, actor_type="api_key", actor_id=kc.key.prefix, action="run.started", entity="pipeline_run",
          entity_id=run.id, detail={"pipeline": (pipeline or agent).name, "message": "Run started through the public API"})
    await db.commit()
    if body.wait:
        import asyncio

        deadline = time.monotonic() + WAIT_MAX_S
        while time.monotonic() < deadline:
            await asyncio.sleep(0.5)
            await db.refresh(run)
            if run.status in TERMINAL:
                break
    return await _public_run(db, run)


@router.post("/workflows/{pipeline_id}/run")
async def public_run_workflow(pipeline_id: str, request: Request, body: PublicRunRequest | None = None,
                              kc: KeyContext = Depends(require_scope("runs:write")), db: AsyncSession = Depends(get_db)):
    try:
        p = await db.get(Pipeline, uuid.UUID(pipeline_id))
    except ValueError:
        p = None
    if p is None or p.tenant_id != kc.tenant.id:
        raise not_found("workflow")
    if not p.enabled:
        raise ApiError(409, "pipeline_disabled", "This workflow is disabled")
    return await _start_public(request, db, kc, body or PublicRunRequest(), pipeline=p, agent=None)


@router.post("/agents/{agent_id}/run")
async def public_run_agent(agent_id: str, request: Request, body: PublicRunRequest | None = None,
                           kc: KeyContext = Depends(require_scope("runs:write")), db: AsyncSession = Depends(get_db)):
    try:
        a = await db.get(Agent, uuid.UUID(agent_id))
    except ValueError:
        a = None
    if a is None or a.tenant_id != kc.tenant.id:
        raise not_found("agent")
    if a.status != "active":
        raise ApiError(409, "agent_not_active", f"This agent is {a.status}")
    return await _start_public(request, db, kc, body or PublicRunRequest(), pipeline=None, agent=a)


@router.get("/runs/{run_id}")
async def public_get_run(run_id: str, kc: KeyContext = Depends(require_scope("runs:read")), db: AsyncSession = Depends(get_db)):
    try:
        run = await db.get(PipelineRun, uuid.UUID(run_id))
    except ValueError:
        run = None
    if run is None or run.tenant_id != kc.tenant.id:
        raise not_found("run")
    return await _public_run(db, run)
