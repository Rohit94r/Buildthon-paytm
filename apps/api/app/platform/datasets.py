"""Datasets: typed fields, value coercion (scraped text -> numbers/lists/booleans), upsert by key field,
search and sort. Scraped values arrive as messy text ("₹ 2.5 lakh", "12.4 LPA", "4.2/5"), so coercion is
deliberately forgiving but never invents a value: anything unparseable becomes null."""

from __future__ import annotations

import re
import uuid
from typing import Any

from dateutil import parser as dateparser
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.models import Dataset, DatasetRecord
from app.platform.catalog import DATASET_FIELD_TYPES
from app.services.text import normalize_space

NUMERIC = ("number", "currency", "rating")
_NUM_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?|-?\.\d+")
_TRUE = {"true", "yes", "y", "1", "available", "in stock", "instock", "open"}
_FALSE = {"false", "no", "n", "0", "unavailable", "out of stock", "outofstock", "closed"}
SEARCH_CAP = 4000


def field_map(ds: Dataset) -> dict[str, dict[str, Any]]:
    return {f["key"]: f for f in ds.fields or []}


def _num(raw: str, unit: str | None) -> float | int | None:
    text = raw.lower().replace("₹", " ").replace("rs.", " ").replace("inr", " ")
    m = _NUM_RE.search(text)
    if not m:
        return None
    try:
        value = float(m.group(0).replace(",", ""))
    except ValueError:
        return None
    tail = text[m.end() : m.end() + 12]
    unit_l = (unit or "").lower()
    # Indian number words, unless the field itself is expressed in lakhs (LPA) or crores.
    if re.match(r"\s*(crore|cr\b)", tail) and "cr" not in unit_l:
        value *= 10_000_000
    elif re.match(r"\s*(lakh|lac|l\b)", tail) and "lpa" not in unit_l and "lakh" not in unit_l:
        value *= 100_000
    return int(value) if value.is_integer() else round(value, 4)


def coerce_value(ftype: str, raw: Any, unit: str | None = None) -> Any:
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = normalize_space(raw)
        if raw == "" or raw.lower() in ("null", "none", "n/a", "na", "-", "—"):
            return None
    if ftype in NUMERIC:
        if isinstance(raw, bool):
            return None
        if isinstance(raw, int | float):
            return raw
        return _num(str(raw), unit)
    if ftype == "boolean":
        if isinstance(raw, bool):
            return raw
        s = str(raw).strip().lower()
        return True if s in _TRUE else False if s in _FALSE else None
    if ftype == "list":
        if isinstance(raw, list):
            return [normalize_space(str(v)) for v in raw if v is not None and str(v).strip()]
        return [p.strip() for p in re.split(r"[,;|\n]", str(raw)) if p.strip()]
    if ftype == "date":
        try:
            return dateparser.parse(str(raw)).date().isoformat()
        except (ValueError, OverflowError, TypeError):
            return str(raw)
    if isinstance(raw, list | dict):
        return ", ".join(str(v) for v in raw) if isinstance(raw, list) else str(raw)
    return str(raw)


def coerce_record(ds: Dataset, data: dict[str, Any]) -> dict[str, Any]:
    """Coerce declared fields; extra keys (e.g. `aliases`, `notes`) are kept as given."""
    out = dict(data)
    for key, f in field_map(ds).items():
        if key in out:
            out[key] = coerce_value(f.get("type", "text"), out[key], f.get("unit"))
    return out


def search_text(key: str, data: dict[str, Any]) -> str:
    parts = [key]
    for v in data.values():
        if isinstance(v, list):
            parts.extend(str(x) for x in v)
        elif v is not None and not isinstance(v, dict):
            parts.append(str(v))
    return normalize_space(" ".join(parts)).lower()[:SEARCH_CAP]


def record_key(ds: Dataset, data: dict[str, Any]) -> str | None:
    value = data.get(ds.key_field)
    if value is None or isinstance(value, list | dict):
        return None
    key = normalize_space(str(value))[:255]
    return key or None


async def upsert_record(
    db: AsyncSession,
    ds: Dataset,
    data: dict[str, Any],
    *,
    source_url: str | None = None,
    update_existing: bool = True,
    replace: bool = False,
) -> tuple[str, DatasetRecord | None]:
    """Insert or update by key field. Returns (created|updated|skipped, record). An update merges: values the
    new data leaves empty never erase what an earlier scrape found (unless `replace`)."""
    data = coerce_record(ds, data)
    key = record_key(ds, data)
    if key is None:
        raise ValueError(f"Record has no value for the key field '{ds.key_field}'")
    row = (
        await db.execute(select(DatasetRecord).where(DatasetRecord.dataset_id == ds.id, DatasetRecord.key == key))
    ).scalar_one_or_none()
    if row is None:
        row = DatasetRecord(tenant_id=ds.tenant_id, dataset_id=ds.id, key=key, data=data, source_url=source_url,
                            search_text=search_text(key, data))
        db.add(row)
        ds.updated_at = utcnow()
        await db.flush()
        return "created", row
    if not update_existing:
        return "skipped", row
    merged = data if replace else {**(row.data or {}), **{k: v for k, v in data.items() if v not in (None, "", [])}}
    row.data = merged
    row.search_text = search_text(key, merged)
    if source_url:
        row.source_url = source_url
    row.updated_at = utcnow()
    ds.updated_at = utcnow()
    return "updated", row


async def record_counts(db: AsyncSession, dataset_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not dataset_ids:
        return {}
    rows = await db.execute(
        select(DatasetRecord.dataset_id, func.count()).where(DatasetRecord.dataset_id.in_(dataset_ids)).group_by(DatasetRecord.dataset_id)
    )
    return {k: int(n) for k, n in rows.all()}


def parse_sort(sort: str | None) -> tuple[str, bool]:
    """`field:desc` / `field:asc` / `field` -> (field, descending). Default: most recently updated first."""
    if not sort:
        return "updated_at", True
    field, _, direction = sort.partition(":")
    return field.strip() or "updated_at", direction.strip().lower() != "asc"


def sort_records(records: list[DatasetRecord], sort: str | None) -> list[DatasetRecord]:
    field, desc = parse_sort(sort)
    if field in ("updated_at", "created_at"):
        return sorted(records, key=lambda r: getattr(r, field), reverse=desc)
    if field == "key":
        return sorted(records, key=lambda r: r.key.lower(), reverse=desc)

    present = [r for r in records if (r.data or {}).get(field) is not None]
    missing = [r for r in records if (r.data or {}).get(field) is None]

    def k(r: DatasetRecord) -> tuple[int, Any]:
        v = r.data[field]
        if isinstance(v, bool):
            return (0, int(v))
        if isinstance(v, int | float):
            return (0, v)
        return (1, str(v).lower())

    # Records without the value always go last, whichever direction is asked for.
    return sorted(present, key=k, reverse=desc) + missing


async def query_records(
    db: AsyncSession, ds: Dataset, *, q: str | None, sort: str | None, limit: int, offset: int
) -> tuple[list[DatasetRecord], int]:
    stmt = select(DatasetRecord).where(DatasetRecord.dataset_id == ds.id)
    for term in (q or "").lower().split()[:6]:
        stmt = stmt.where(DatasetRecord.search_text.like(f"%{term.replace('%', '').replace('_', '')}%"))
    rows = list((await db.execute(stmt.limit(10_000))).scalars())
    rows = sort_records(rows, sort)
    return rows[offset : offset + limit], len(rows)


def validate_fields(fields: list[dict[str, Any]], key_field: str) -> list[dict[str, Any]]:
    """Normalise a DatasetField list; raises ValueError with a readable message."""
    out, seen = [], set()
    for f in fields:
        key = str(f.get("key") or "").strip()
        if not key or not key[0].isalpha() or not key.replace("_", "").isalnum():
            raise ValueError(f"Invalid field key '{key}': use letters, digits and _ (start with a letter)")
        if key in seen:
            raise ValueError(f"Duplicate field key '{key}'")
        seen.add(key)
        ftype = f.get("type") or "text"
        if ftype not in DATASET_FIELD_TYPES:
            raise ValueError(f"Field '{key}' has unknown type '{ftype}'")
        item: dict[str, Any] = {"key": key, "label": str(f.get("label") or key.replace("_", " ").capitalize()), "type": ftype}
        for opt in ("compare", "higher_is_better"):
            if f.get(opt) is not None:
                item[opt] = bool(f[opt])
        if f.get("unit"):
            item["unit"] = str(f["unit"])[:16]
        out.append(item)
    if key_field not in seen:
        raise ValueError(f"key_field '{key_field}' must be one of the fields")
    return out
