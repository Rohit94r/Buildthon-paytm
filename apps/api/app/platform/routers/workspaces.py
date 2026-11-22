"""Workspaces (clients), blueprints + packages, plans, the operator overview / health and the workspace dashboard."""

from __future__ import annotations

import re
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import utcnow
from app.core.deps import Principal, current_principal, get_db, membership_role, platform_admin, require
from app.core.errors import ApiError, bad_request, not_found
from app.models import (
    AuditLog,
    ContentItem,
    EvalCase,
    EvalRun,
    Job,
    JobEvent,
    Membership,
    ModelRun,
    Pipeline,
    PipelineRun,
    Tenant,
    WorkerHeartbeat,
)
from app.platform import stats as st
from app.platform.blueprints import BLUEPRINTS, PACKAGES, apply_blueprint, package_out
from app.platform.plans import PLANS, plan_out
from app.platform.schemas import INDUSTRIES, WorkspaceCreate, WorkspaceDelete, WorkspacePatch
from app.platform.serializers import agent_out, content_out, dataset_out, pipeline_out, run_out, workspace_out
from app.providers.registry import get_provider
from app.services.integrations import kv_get, kv_set
from app.services.slug import slugify

router = APIRouter(tags=["platform"])
DEFAULT_MODULES = ["pipelines", "datasets", "assistant"]
TABLES_WITHOUT_FK = (Job, JobEvent, ModelRun, AuditLog, EvalCase, EvalRun)


async def _workspace(db: AsyncSession, principal: Principal, slug: str) -> tuple[Tenant, str | None]:
    """The workspace and the caller's role in it (None for a platform admin without a membership)."""
    t = (await db.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
    if t is None:
        raise not_found("workspace")
    role = await membership_role(db, principal.user, t.id)
    if role is None and not principal.is_platform_admin:
        raise ApiError(403, "workspace_forbidden", "You do not have access to that workspace")
    return t, role


def _check_industry(value: str | None) -> None:
    if value is not None and value not in INDUSTRIES:
        raise bad_request("invalid_industry", f"industry must be one of {', '.join(INDUSTRIES)}")


def _check_tz(value: str | None) -> None:
    if value:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise bad_request("invalid_timezone", f"Unknown timezone '{value}'") from exc


@router.get("/workspaces")
async def list_workspaces(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    if principal.is_platform_admin:
        tenants = list((await db.execute(select(Tenant).order_by(Tenant.created_at))).scalars())
    else:
        ids = set((await db.execute(select(Membership.tenant_id).where(Membership.user_id == principal.user.id,
                                                                       Membership.status == "active"))).scalars())
        ids.add(principal.user.tenant_id)
        tenants = list((await db.execute(select(Tenant).where(Tenant.id.in_(ids)).order_by(Tenant.created_at))).scalars())
    stats = await st.workspace_stats(db, [t.id for t in tenants])
    return {"items": [workspace_out(t, stats.get(t.id)) for t in tenants]}


@router.post("/workspaces")
async def create_workspace(body: WorkspaceCreate, principal: Principal = Depends(platform_admin), db: AsyncSession = Depends(get_db)):
    _check_industry(body.industry)
    _check_tz(body.timezone)
    if body.blueprint and body.blueprint not in BLUEPRINTS:
        raise bad_request("unknown_blueprint", f"Unknown blueprint '{body.blueprint}'")
    slug = body.slug or re.sub(r"-+", "-", slugify(body.name, max_words=4).strip("-"))[:40] or "workspace"
    if (await db.execute(select(Tenant.id).where(Tenant.slug == slug))).scalar_one_or_none() is not None:
        raise ApiError(409, "slug_taken", f"A workspace with slug '{slug}' already exists")
    domain = (body.domain or "").removeprefix("https://").removeprefix("http://").strip("/") or None
    tenant = Tenant(
        slug=slug, name=body.name, domain=domain, timezone=body.timezone or "Asia/Kolkata",
        industry=body.industry, brand_color=body.brand_color or "#2563eb", plan="free",
        modules=[] if body.blueprint else list(DEFAULT_MODULES), website=f"https://{domain}" if domain else None,
        settings={"brand": {"name": body.name, "short_name": body.name[:24], **({"site_url": f"https://{domain}"} if domain else {})}},
    )
    db.add(tenant)
    await db.flush()
    # The operator who creates a client workspace manages it as its owner.
    db.add(Membership(user_id=principal.user.id, tenant_id=tenant.id, role="owner", status="active"))
    if body.blueprint:
        await apply_blueprint(db, tenant, body.blueprint, check_quota=False)
    audit(db, tenant_id=tenant.id, actor_type="user", actor_id=principal.user.id, action="workspace.created", entity="tenant",
          entity_id=tenant.id, detail={"message": f"Workspace {tenant.name} created" + (f" from {body.blueprint}" if body.blueprint else "")})
    await db.commit()
    stats = await st.workspace_stats(db, [tenant.id])
    return workspace_out(tenant, stats.get(tenant.id))


@router.get("/workspaces/{slug}")
async def get_workspace(slug: str, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    t, _ = await _workspace(db, principal, slug)
    return workspace_out(t, (await st.workspace_stats(db, [t.id])).get(t.id))


@router.patch("/workspaces/{slug}")
async def patch_workspace(slug: str, body: WorkspacePatch, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    t, role = await _workspace(db, principal, slug)
    if not principal.is_platform_admin and role not in ("owner", "admin"):
        raise ApiError(403, "permission_denied", "Only owners and admins can change workspace settings")
    data = body.model_dump(exclude_unset=True)
    if ("status" in data or "plan" in data) and not principal.is_platform_admin:
        raise ApiError(403, "platform_admin_required", "Only a platform admin can change the plan or suspend a workspace")
    _check_industry(body.industry)
    _check_tz(body.timezone)
    if "domain" in data:
        data["domain"] = (data["domain"] or "").removeprefix("https://").removeprefix("http://").strip("/") or None
    if "modules" in data:
        data["modules"] = list(dict.fromkeys(data["modules"] or []))
    if "models" in data:
        # Model gateway: "fast"/"writer" agents in this workspace use these tags instead of the instance defaults.
        overrides = {k: v.strip() for k, v in (data.pop("models") or {}).items() if v and v.strip()}
        t.settings = {**(t.settings or {}), "platform_models": overrides}
    for k, v in data.items():
        if v is not None or k in ("domain", "website"):
            setattr(t, k, v)
    audit(db, tenant_id=t.id, actor_type="user", actor_id=principal.user.id, action="workspace.updated", entity="tenant", entity_id=t.id,
          detail={"fields": sorted(data), **({"plan": t.plan} if "plan" in data else {}), **({"status": t.status} if "status" in data else {})})
    await db.commit()
    return workspace_out(t, (await st.workspace_stats(db, [t.id])).get(t.id))


@router.delete("/workspaces/{slug}", status_code=204)
async def delete_workspace(slug: str, body: WorkspaceDelete, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    t, role = await _workspace(db, principal, slug)
    if not principal.is_platform_admin and role != "owner":
        raise ApiError(403, "permission_denied", "Only the owner or a platform admin can delete a workspace")
    if body.confirm != t.slug:
        raise bad_request("confirm_mismatch", "Type the workspace slug to confirm")
    if t.id == principal.user.tenant_id:
        raise ApiError(409, "home_workspace", "Your home workspace cannot be deleted")
    for model in TABLES_WITHOUT_FK:
        await db.execute(delete(model).where(model.tenant_id == t.id))
    await db.execute(delete(Tenant).where(Tenant.id == t.id))  # everything else cascades
    await db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- blueprints + packages
def _created_out(created: dict[str, list[Any]]) -> dict[str, Any]:
    agents = {str(a.id): a for a in created["agents"]}
    return {"agents": [agent_out(a) for a in created["agents"]], "pipelines": [pipeline_out(p, agents) for p in created["pipelines"]],
            "datasets": [dataset_out(d) for d in created["datasets"]]}


@router.get("/blueprints")
async def list_blueprints(_: Principal = Depends(current_principal)):
    return {"items": [b.out() for b in BLUEPRINTS.values()]}


@router.post("/blueprints/{key}/apply")
async def apply(key: str, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    if key not in BLUEPRINTS:
        raise not_found("blueprint")
    tenant = await db.get(Tenant, principal.tenant_id)
    created = await apply_blueprint(db, tenant, key)
    audit(db, tenant_id=tenant.id, actor_type="user", actor_id=principal.user.id, action="blueprint.applied", entity="tenant",
          entity_id=tenant.id, detail={"message": f"Applied blueprint {BLUEPRINTS[key].name}"})
    await db.commit()
    return _created_out(created)


@router.get("/packages")
async def list_packages(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    return {"items": [package_out(k, await kv_get(db, principal.tenant_id, f"package:{k}")) for k in PACKAGES]}


@router.post("/packages/{key}/install")
async def install_package(key: str, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    if key not in PACKAGES:
        raise not_found("package")
    tenant = await db.get(Tenant, principal.tenant_id)
    bp = BLUEPRINTS[PACKAGES[key]]
    created = await apply_blueprint(db, tenant, PACKAGES[key], package_key=key)
    await kv_set(db, tenant.id, f"package:{key}", {"version": bp.version, "at": utcnow().isoformat()})
    audit(db, tenant_id=tenant.id, actor_type="user", actor_id=principal.user.id, action="package.installed", entity="tenant",
          entity_id=tenant.id, detail={"message": f"Installed package {bp.name} v{bp.version}", "skipped": created["skipped"]})
    await db.commit()
    return {
        "created": {"agents": len(created["new_agents"]), "pipelines": len(created["new_pipelines"]), "datasets": len(created["new_datasets"])},
        "skipped": created["skipped"],
        "package": {"key": key, "version": bp.version},
    }


@router.get("/plans")
async def plans(_: Principal = Depends(current_principal)):
    return {"items": [plan_out(k) for k in PLANS]}


# ---------------------------------------------------------------- dashboards
async def _models() -> tuple[list[dict[str, Any]], str, Any]:
    from app.platform.runtime import model_profiles

    provider = get_provider()
    try:
        health = await provider.health()
        have = set(health.models)
    except Exception:  # an unreachable model server must not break the overview
        health, have = None, set()

    def present(m: str) -> bool:
        return m in have or f"{m}:latest" in have

    return [{"name": p["model"], "role": role, "size_gb": None, "loaded": present(p["model"])}
            for role, p in model_profiles().items() if p["model"]], provider.name, health


@router.get("/platform/overview")
async def overview(_: Principal = Depends(platform_admin), db: AsyncSession = Depends(get_db)):
    tenants = list((await db.execute(select(Tenant).order_by(Tenant.created_at))).scalars())
    stats = await st.workspace_stats(db)
    totals = {k: 0 for k in ("agents", "pipelines", "runs_24h", "failed_24h", "content_7d", "published_7d", "records")}
    for t in tenants:
        for k in totals:
            totals[k] += stats.get(t.id, {}).get(k, 0)
    queue = dict((await db.execute(select(Job.status, func.count()).where(Job.status.in_(("queued", "running"))).group_by(Job.status))).all())
    models, provider, _ = await _models()
    return {
        "totals": {"workspaces": len(tenants), **totals},
        "runs_by_day": await st.runs_by_day(db),
        "workspaces": [workspace_out(t, stats.get(t.id)) for t in tenants],
        "activity": await st.activity(db, limit=40),
        "models": models,
        "provider": provider,
        "queue": {"queued": int(queue.get("queued", 0)), "running": int(queue.get("running", 0))},
    }


@router.get("/platform/health")
async def platform_health(_: Principal = Depends(platform_admin), db: AsyncSession = Depends(get_db)):
    models, provider, health = await _models()
    missing = [m["name"] for m in models if not m["loaded"] and m["role"] != "embed"]
    status = "down" if health is None or not health.ok else ("degraded" if missing and provider != "mock" else "ok")
    counts = dict((await db.execute(select(Job.status, func.count()).group_by(Job.status))).all())
    since = utcnow() - timedelta(hours=24)
    failed_24h = (await db.execute(select(func.count()).select_from(Job).where(Job.status.in_(("failed", "dead")), Job.finished_at >= since))).scalar_one()
    oldest = (await db.execute(select(func.min(Job.available_at)).where(Job.status == "queued", Job.available_at <= utcnow()))).scalar_one()
    workers = [{"id": w.worker_id, "last_seen": w.last_seen.isoformat(), "running": len((w.info or {}).get("running") or {})}
               for w in (await db.execute(select(WorkerHeartbeat).order_by(WorkerHeartbeat.last_seen.desc()))).scalars()]
    slugs = dict((await db.execute(select(Tenant.id, Tenant.slug))).all())
    errors = [{"at": (r.finished_at or r.created_at).isoformat(), "workspace": slugs.get(r.tenant_id, ""), "message": (r.error or "failed")[:300]}
              for r in (await db.execute(select(PipelineRun).where(PipelineRun.status == "failed", PipelineRun.created_at >= since)
                                         .order_by(PipelineRun.created_at.desc()).limit(30))).scalars()]
    errors += [{"at": j.finished_at.isoformat(), "workspace": slugs.get(j.tenant_id, ""), "message": f"{j.type}: {(j.last_error or '')[:280]}"}
               for j in (await db.execute(select(Job).where(Job.status.in_(("failed", "dead")), Job.finished_at >= since, Job.type != "pipeline_run")
                                          .order_by(Job.finished_at.desc()).limit(30))).scalars()]
    return {
        "provider": provider,
        "model": {"status": status, "detail": (health.detail if health else "Model server unreachable") or
                  (f"Not pulled: {', '.join(missing)}" if missing and provider != "mock" else None), "models": health.models if health else []},
        "queue": {"queued": int(counts.get("queued", 0)), "running": int(counts.get("running", 0)), "failed_24h": int(failed_24h),
                  "dead": int(counts.get("dead", 0)), "oldest_queued_age_s": int((utcnow() - oldest).total_seconds()) if oldest else None},
        "workers": workers,
        "errors_24h": sorted(errors, key=lambda e: e["at"], reverse=True)[:40],
    }


@router.get("/dashboard/workspace")
async def workspace_dashboard(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    t = principal.tenant
    stats = await st.workspace_stats(db, [t.id])
    runs = list((await db.execute(
        select(PipelineRun).where(PipelineRun.tenant_id == t.id).order_by(PipelineRun.created_at.desc()).limit(8)
    )).scalars())
    names = dict((await db.execute(select(Pipeline.id, Pipeline.name).where(Pipeline.tenant_id == t.id))).all())
    from app.models import Agent

    names.update(dict((await db.execute(select(Agent.id, Agent.name).where(Agent.tenant_id == t.id))).all()))
    recent = list((await db.execute(
        select(ContentItem).where(ContentItem.tenant_id == t.id).order_by(ContentItem.created_at.desc()).limit(6)
    )).scalars())
    pending = (await db.execute(
        select(func.count()).select_from(ContentItem).where(ContentItem.tenant_id == t.id, ContentItem.status == "draft")
    )).scalar_one()
    return {
        "workspace": workspace_out(t, stats.get(t.id)),
        "runs_by_day": await st.runs_by_day(db, t.id),
        "recent_runs": [run_out(r, names.get(r.pipeline_id or r.agent_id, "(deleted)")) for r in runs],
        "pending_approval": int(pending),
        "recent_content": [content_out(c, names.get(c.pipeline_id)) for c in recent],
        "activity": await st.activity(db, t.id, limit=25),
    }
