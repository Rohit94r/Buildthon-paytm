"""Datasets, their records (search / sort / upsert / import) and the assistant playground."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import utcnow
from app.core.deps import Principal, current_principal, get_db, require
from app.core.errors import ApiError, bad_request, not_found
from app.models import Agent, Dataset, DatasetRecord, Tenant
from app.platform.assistant import chat, resolve_dataset
from app.platform.datasets import (
    coerce_record,
    query_records,
    record_counts,
    record_key,
    search_text,
    upsert_record,
    validate_fields,
)
from app.platform.plans import check_records
from app.platform.schemas import ChatRequest, DatasetPatch, DatasetWrite, ImportIn, RecordPatch, RecordWrite
from app.platform.serializers import dataset_out, record_out
from app.routers.common import owned
from app.services.slug import slugify

router = APIRouter(tags=["datasets"])


def _fields(fields, key_field: str) -> list[dict]:
    try:
        return validate_fields([f.model_dump(exclude_none=True) for f in fields], key_field)
    except ValueError as exc:
        raise ApiError(422, "invalid_fields", str(exc)) from exc


async def _slug_free(db: AsyncSession, tenant_id: uuid.UUID, slug: str, exclude: uuid.UUID | None = None) -> None:
    row = (await db.execute(select(Dataset.id).where(Dataset.tenant_id == tenant_id, Dataset.slug == slug))).scalar_one_or_none()
    if row is not None and row != exclude:
        raise ApiError(409, "slug_taken", f"A dataset with slug '{slug}' already exists")


@router.get("/datasets")
async def list_datasets(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    rows = list((await db.execute(select(Dataset).where(Dataset.tenant_id == principal.tenant_id).order_by(Dataset.created_at))).scalars())
    counts = await record_counts(db, [d.id for d in rows])
    return {"items": [dataset_out(d, counts.get(d.id, 0)) for d in rows]}


@router.post("/datasets")
async def create_dataset(body: DatasetWrite, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    slug = body.slug or slugify(body.name, max_words=5).replace("article", "dataset")
    await _slug_free(db, principal.tenant_id, slug)
    ds = Dataset(tenant_id=principal.tenant_id, name=body.name, slug=slug, description=body.description or "",
                 key_field=body.key_field, fields=_fields(body.fields, body.key_field), public=bool(body.public))
    db.add(ds)
    await db.flush()
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="dataset.created", entity="dataset",
          entity_id=ds.id, detail={"message": f"Dataset {ds.name} created"})
    await db.commit()
    return dataset_out(ds, 0)


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    ds = await owned(db, Dataset, dataset_id, principal.tenant_id, "dataset")
    return dataset_out(ds, (await record_counts(db, [ds.id])).get(ds.id, 0))


@router.patch("/datasets/{dataset_id}")
async def patch_dataset(dataset_id: str, body: DatasetPatch, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    ds = await owned(db, Dataset, dataset_id, principal.tenant_id, "dataset")
    key_field = body.key_field or ds.key_field
    if body.key_field and body.key_field != ds.key_field:
        n = (await record_counts(db, [ds.id])).get(ds.id, 0)
        if n:
            raise ApiError(409, "key_field_locked", "The key field cannot change while the dataset has records")
    if body.fields is not None:
        ds.fields = _fields(body.fields, key_field)
    elif body.key_field and body.key_field not in {f["key"] for f in ds.fields or []}:
        raise ApiError(422, "invalid_fields", f"key_field '{body.key_field}' must be one of the fields")
    ds.key_field = key_field
    if body.slug and body.slug != ds.slug:
        await _slug_free(db, principal.tenant_id, body.slug, ds.id)
        ds.slug = body.slug
    for k in ("name", "description", "public"):
        v = getattr(body, k)
        if v is not None:
            setattr(ds, k, v)
    ds.updated_at = utcnow()
    await db.commit()
    return dataset_out(ds, (await record_counts(db, [ds.id])).get(ds.id, 0))


@router.delete("/datasets/{dataset_id}", status_code=204)
async def delete_dataset(dataset_id: str, principal: Principal = Depends(require("agents.manage")), db: AsyncSession = Depends(get_db)):
    ds = await owned(db, Dataset, dataset_id, principal.tenant_id, "dataset")
    users = [a.name for a in (await db.execute(select(Agent).where(Agent.tenant_id == principal.tenant_id))).scalars()
             if (a.config or {}).get("dataset") == str(ds.id)]
    if users:
        raise ApiError(409, "dataset_in_use", f"Used by agent(s): {', '.join(users)}", {"agents": users})
    await db.delete(ds)
    await db.commit()
    return Response(status_code=204)


@router.get("/datasets/{dataset_id}/records")
async def list_records(
    dataset_id: str,
    q: str | None = None,
    sort: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    principal: Principal = Depends(current_principal),
    db: AsyncSession = Depends(get_db),
):
    ds = await owned(db, Dataset, dataset_id, principal.tenant_id, "dataset")
    rows, total = await query_records(db, ds, q=q, sort=sort, limit=limit, offset=offset)
    return {"items": [record_out(r) for r in rows], "total": total}


@router.post("/datasets/{dataset_id}/records")
async def upsert(dataset_id: str, body: RecordWrite, principal: Principal = Depends(require("data.edit")), db: AsyncSession = Depends(get_db)):
    ds = await owned(db, Dataset, dataset_id, principal.tenant_id, "dataset")
    key = record_key(ds, coerce_record(ds, body.data))
    if key is not None and (await db.execute(select(DatasetRecord.id).where(DatasetRecord.dataset_id == ds.id, DatasetRecord.key == key))).scalar_one_or_none() is None:
        await check_records(db, await db.get(Tenant, principal.tenant_id))
    try:
        outcome, row = await upsert_record(db, ds, body.data, source_url=body.source_url, replace=True)
    except ValueError as exc:
        raise ApiError(422, "missing_key", str(exc)) from exc
    await db.commit()
    await db.refresh(row)
    return record_out(row)


@router.patch("/datasets/{dataset_id}/records/{record_id}")
async def patch_record(dataset_id: str, record_id: str, body: RecordPatch, principal: Principal = Depends(require("data.edit")), db: AsyncSession = Depends(get_db)):
    ds = await owned(db, Dataset, dataset_id, principal.tenant_id, "dataset")
    row = await owned(db, DatasetRecord, record_id, principal.tenant_id, "record")
    if row.dataset_id != ds.id:
        raise not_found("record")
    if body.data is not None:
        merged = coerce_record(ds, {**(row.data or {}), **body.data})
        key = record_key(ds, merged)
        if key is None:
            raise ApiError(422, "missing_key", f"Record has no value for the key field '{ds.key_field}'")
        row.key, row.data, row.search_text = key, merged, search_text(key, merged)
    if body.source_url is not None:
        row.source_url = body.source_url or None
    row.updated_at = ds.updated_at = utcnow()
    try:
        await db.commit()
    except IntegrityError as exc:
        raise ApiError(409, "duplicate_key", "Another record already has that key") from exc
    await db.refresh(row)
    return record_out(row)


@router.delete("/datasets/{dataset_id}/records/{record_id}", status_code=204)
async def delete_record(dataset_id: str, record_id: str, principal: Principal = Depends(require("data.edit")), db: AsyncSession = Depends(get_db)):
    ds = await owned(db, Dataset, dataset_id, principal.tenant_id, "dataset")
    row = await owned(db, DatasetRecord, record_id, principal.tenant_id, "record")
    if row.dataset_id != ds.id:
        raise not_found("record")
    await db.delete(row)
    await db.commit()
    return Response(status_code=204)


@router.post("/datasets/{dataset_id}/import")
async def import_rows(dataset_id: str, body: ImportIn, principal: Principal = Depends(require("data.edit")), db: AsyncSession = Depends(get_db)):
    ds = await owned(db, Dataset, dataset_id, principal.tenant_id, "dataset")
    tenant = await db.get(Tenant, principal.tenant_id)
    existing = set((await db.execute(select(DatasetRecord.key).where(DatasetRecord.dataset_id == ds.id))).scalars())
    new_keys = {k for k in (record_key(ds, coerce_record(ds, r)) for r in body.rows) if k and k not in existing}
    await check_records(db, tenant, adding=len(new_keys))
    counts = {"created": 0, "updated": 0, "skipped": 0}
    for row in body.rows:
        source = row.pop("source_url", None) if isinstance(row.get("source_url"), str) else None
        try:
            outcome, _ = await upsert_record(db, ds, row, source_url=source)
        except ValueError:
            counts["skipped"] += 1
            continue
        counts[outcome] += 1
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="dataset.imported", entity="dataset",
          entity_id=ds.id, detail={"message": f"Imported into {ds.name}: {counts['created']} new, {counts['updated']} updated, {counts['skipped']} skipped"})
    await db.commit()
    return counts


# ---------------------------------------------------------------- assistant
async def answer_chat(db: AsyncSession, tenant: Tenant, body: ChatRequest) -> dict:
    """Shared by the dashboard playground and the public /chat endpoint."""
    config: dict = {}
    model, name = "fast", "Comparison Assistant"
    ds = None
    if body.assistant_id:
        try:
            agent = await db.get(Agent, uuid.UUID(body.assistant_id))
        except ValueError:
            agent = None
        if agent is None or agent.tenant_id != tenant.id or agent.kind != "comparison_assistant":
            raise not_found("assistant")
        if not agent.enabled:
            raise ApiError(409, "assistant_disabled", "This assistant is disabled")
        config, model, name = dict(agent.config or {}), agent.model, agent.name
        ds = await resolve_dataset(db, tenant.id, config.get("dataset", ""))
    elif body.dataset:
        ds = await resolve_dataset(db, tenant.id, body.dataset)
    else:
        raise bad_request("dataset_required", "Pass assistant_id or dataset")
    if ds is None:
        raise not_found("dataset")
    return await chat(
        db, tenant, ds, message=body.message, history=[h.model_dump() for h in body.history or []],
        compare_keys=body.compare_keys, config=config, model=model, agent_name=name,
    )


@router.post("/assistant/chat")
async def assistant_chat(body: ChatRequest, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    tenant = await db.get(Tenant, principal.tenant_id)
    return await answer_chat(db, tenant, body)
