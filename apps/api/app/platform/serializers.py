"""Wire format of the platform API. Mirrors apps/web/lib/platform-types.ts exactly: change both together."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.core.config import get_settings
from app.core.security import decrypt_secret
from app.models import (
    Agent,
    ApiKey,
    Connection,
    ContentItem,
    Dataset,
    DatasetRecord,
    Pipeline,
    PipelineRun,
    Tenant,
)
from app.platform.connections import CONNECTION_KINDS, read_secrets, status_of
from app.platform.content import primary_format, variant_body
from app.platform.markdown import to_html


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


EMPTY_STATS = {"agents": 0, "pipelines": 0, "runs_24h": 0, "failed_24h": 0, "content_7d": 0, "published_7d": 0, "records": 0}


def workspace_lite_out(t: Tenant) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "slug": t.slug,
        "name": t.name,
        "industry": t.industry or "other",
        "brand_color": t.brand_color or "#2563eb",
        "modules": list(t.modules or []),
    }


def workspace_out(t: Tenant, stats: dict[str, int] | None = None) -> dict[str, Any]:
    return {
        **workspace_lite_out(t),
        "domain": t.domain,
        "timezone": t.timezone,
        "blueprint": t.blueprint,
        "status": t.status or "active",
        "plan": t.plan or "free",
        "website": t.website,
        "created_at": iso(t.created_at),
        "stats": {**EMPTY_STATS, **(stats or {})},
    }


def agent_out(a: Agent, stats: dict[str, Any] | None = None, live: dict[str, Any] | None = None) -> dict[str, Any]:
    """ManagedAgent = Agent & AgentLifecycle."""
    from app.platform.tools import KIND_TOOLS

    limits = a.limits or {}
    return {
        "id": str(a.id),
        "name": a.name,
        "kind": a.kind,
        "description": a.description or "",
        "config": a.config or {},
        "model": a.model,
        "enabled": a.enabled,
        "created_at": iso(a.created_at),
        "updated_at": iso(a.updated_at),
        "stats": stats or {"runs": 0, "last_run_at": None, "success_rate": None, "avg_ms": None},
        "status": a.status or ("active" if a.enabled else "disabled"),
        "version": a.version or 1,
        "source": a.source or "custom",
        "catalog_key": a.catalog_key,
        "package_key": a.package_key,
        "schedule": {"every_minutes": a.every_minutes, "next_run_at": iso(a.next_run_at)},
        "requires_approval": bool(a.requires_approval),
        "limits": {"max_items": int(limits.get("max_items") or 0), "timeout_s": int(limits.get("timeout_s") or 1800),
                   "max_retries": int(limits.get("max_retries") or 0)},
        "tools": list(a.tools or KIND_TOOLS.get(a.kind, [])),
        "live": live,
        "last_error": a.last_error,
    }


def webhook_url(p: Pipeline, *, reveal: bool = True) -> str | None:
    if p.trigger_type != "webhook" or not p.webhook_token_enc or not reveal:
        return None
    token = decrypt_secret(p.webhook_token_enc)
    base = get_settings().app_base_url.rstrip("/")
    return f"{base}/api/public/v1/hooks/pipelines/{p.id}?token={token}" if token else None


def _ms(start: datetime | None, end: datetime | None) -> int | None:
    return int((end - start).total_seconds() * 1000) if start and end else None


def run_summary_out(r: PipelineRun) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "status": r.status,
        "trigger": r.trigger,
        "started_at": iso(r.started_at),
        "finished_at": iso(r.finished_at),
        "duration_ms": _ms(r.started_at, r.finished_at),
        "items_out": r.items_out or 0,
        "content_created": r.content_created or 0,
    }


RUN_STEP_KEYS = ("step_id", "agent_id", "agent_name", "kind", "status", "started_at", "finished_at", "duration_ms",
                 "items_in", "items_out", "logs", "error", "type", "label", "attempts")


def run_out(r: PipelineRun, pipeline_name: str) -> dict[str, Any]:
    """PipelineRun. Single-agent runs have pipeline_id null, pipeline_name = the agent's name and agent_id set."""
    return {
        **run_summary_out(r),
        "pipeline_id": str(r.pipeline_id) if r.pipeline_id else None,
        "agent_id": str(r.agent_id) if r.agent_id else None,
        "pipeline_name": pipeline_name,
        "error": r.error,
        "steps": [{k: s.get(k) for k in RUN_STEP_KEYS} for s in r.steps or []],
        "created_at": iso(r.created_at),
    }


def pipeline_out(
    p: Pipeline, agents: dict[str, Agent], *, last_run: PipelineRun | None = None, runs_7d: int = 0, reveal: bool = True
) -> dict[str, Any]:
    steps = []
    for s in p.steps or []:
        stype = s.get("type") or "agent"
        agent = agents.get(str(s.get("agent_id"))) if stype == "agent" else None
        steps.append({
            "id": s.get("id"),
            "agent_id": str(s.get("agent_id")) if stype == "agent" else None,
            "agent_name": (agent.name if agent else "(deleted agent)") if stype == "agent" else (s.get("label") or "Approval"),
            "kind": agent.kind if agent else None,
            "overrides": s.get("overrides") or {},
            "type": stype,
            "condition": s.get("condition"),
            "on_error": s.get("on_error") or "stop",
            "retries": int(s.get("retries") or 0),
            "label": s.get("label"),
        })
    return {
        "id": str(p.id),
        "name": p.name,
        "description": p.description or "",
        "steps": steps,
        "trigger": {
            "type": p.trigger_type,
            "every_minutes": p.every_minutes if p.trigger_type == "schedule" else None,
            "webhook_url": webhook_url(p, reveal=reveal),
        },
        "require_approval": p.require_approval,
        "enabled": p.enabled,
        "next_run_at": iso(p.next_run_at),
        "last_run": run_summary_out(last_run) if last_run else None,
        "runs_7d": runs_7d,
        "version": p.version or 1,
        "created_at": iso(p.created_at),
        "updated_at": iso(p.updated_at),
    }


SEO_KEYS = ("title_tag", "meta_description", "keywords", "json_ld")
PUB_KEYS = ("connection_id", "connection_name", "kind", "format", "status", "url", "error", "at")


def content_out(c: ContentItem, pipeline_name: str | None = None) -> dict[str, Any]:
    return {
        "id": str(c.id),
        "run_id": str(c.run_id) if c.run_id else None,
        "pipeline_id": str(c.pipeline_id) if c.pipeline_id else None,
        "pipeline_name": pipeline_name,
        "title": c.title,
        "slug": c.slug,
        "summary": c.summary or "",
        "source_url": c.source_url,
        "source_name": c.source_name,
        "persona": c.persona,
        "status": c.status,
        "tags": list(c.tags or []),
        "image_url": c.image_url,
        "images": list(c.images or []),
        "seo": {k: c.seo[k] for k in SEO_KEYS if k in c.seo} if c.seo else None,
        "quality": {"score": c.quality.get("score", 0), "flags": list(c.quality.get("flags") or [])} if c.quality else None,
        "variants": [
            {"format": v.get("format"), "title": v.get("title"), "body": v.get("body") or "", "char_count": len(v.get("body") or "")}
            for v in c.variants or []
        ],
        "publications": [{k: p.get(k) for k in PUB_KEYS} for p in c.publications or []],
        "created_at": iso(c.created_at),
        "updated_at": iso(c.updated_at),
        "published_at": iso(c.published_at),
    }


def public_content_out(c: ContentItem, fmt: str | None = "article") -> dict[str, Any]:
    """PublicContent (API.md §3): what client websites receive, via the public API and outbound webhooks."""
    chosen = primary_format(c, fmt) or "article"
    if fmt == "article" and chosen != "article" and variant_body(c, "blog_post"):
        chosen = "blog_post"
    body = variant_body(c, chosen) or c.summary or ""
    seo = c.seo or {}
    return {
        "id": str(c.id),
        "slug": c.slug,
        "title": c.title,
        "summary": c.summary or "",
        "body_markdown": body,
        "body_html": to_html(body),
        "format": chosen,
        "variants": {v.get("format"): v.get("body") or "" for v in c.variants or []},
        "tags": list(c.tags or []),
        "image_url": (c.images or [{}])[0].get("url") or c.image_url,
        "images": list(c.images or []),
        "source_url": c.source_url,
        "seo": {"title_tag": seo.get("title_tag") or c.title, "meta_description": seo.get("meta_description") or c.summary or "",
                "json_ld": seo.get("json_ld") or {}},
        "published_at": iso(c.published_at),
    }


def connection_out(c: Connection) -> dict[str, Any]:
    secret_keys = CONNECTION_KINDS[c.kind].secret_keys if c.kind in CONNECTION_KINDS else set()
    secrets = read_secrets(c)
    return {
        "id": str(c.id),
        "name": c.name,
        "kind": c.kind,
        "config": {k: v for k, v in (c.config or {}).items() if k not in secret_keys},
        "secrets_set": sorted(k for k in secret_keys if secrets.get(k)),
        "status": status_of(c) if c.kind in CONNECTION_KINDS else "error",
        "last_used_at": iso(c.last_used_at),
        "last_error": c.last_error,
        "created_at": iso(c.created_at),
    }


def dataset_out(d: Dataset, record_count: int = 0) -> dict[str, Any]:
    return {
        "id": str(d.id),
        "name": d.name,
        "slug": d.slug,
        "description": d.description or "",
        "key_field": d.key_field,
        "fields": d.fields or [],
        "public": d.public,
        "record_count": record_count,
        "updated_at": iso(d.updated_at),
        "created_at": iso(d.created_at),
    }


def record_out(r: DatasetRecord) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "dataset_id": str(r.dataset_id),
        "key": r.key,
        "data": r.data or {},
        "source_url": r.source_url,
        "updated_at": iso(r.updated_at),
        "created_at": iso(r.created_at),
    }


def api_key_out(k: ApiKey) -> dict[str, Any]:
    return {
        "id": str(k.id),
        "name": k.name,
        "prefix": k.prefix,
        "scopes": list(k.scopes or []),
        "last_used_at": iso(k.last_used_at),
        "created_at": iso(k.created_at),
        "revoked": k.revoked_at is not None,
    }


def public_run_out(r: PipelineRun, *, workflow: Pipeline | None, agent: Agent | None) -> dict[str, Any]:
    """PublicRun (API.md §8): what a client website sees of a run it started."""
    from app.platform.flow import FlowItem

    items = [FlowItem.from_dict(i).out() for i in (r.items or [])[:50]] if r.status == "succeeded" else []
    return {
        "id": str(r.id),
        "status": r.status,
        "workflow": {"id": str(workflow.id), "name": workflow.name} if workflow else None,
        "agent": {"id": str(agent.id), "name": agent.name} if agent else None,
        "created_at": iso(r.created_at),
        "finished_at": iso(r.finished_at),
        "steps": [{"name": s.get("label") or s.get("agent_name"), "status": s.get("status"), "items_out": s.get("items_out") or 0}
                  for s in r.steps or []],
        "output": {"items": items, "content_ids": [i.get("content_id") for i in r.items or [] if i.get("content_id")]}
        if r.status == "succeeded" else None,
        "error": r.error,
    }


def member_out(m: Any, u: Any) -> dict[str, Any]:
    return {"id": str(m.id), "user_id": str(u.id), "email": u.email, "name": u.name, "role": m.role, "status": m.status,
            "last_login_at": iso(u.last_login_at), "created_at": iso(m.created_at)}
