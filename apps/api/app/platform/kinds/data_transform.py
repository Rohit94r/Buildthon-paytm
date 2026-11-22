"""data_transform (Data Cleaner): rename/set fields, de-duplicate, filter, sort, limit and optionally
AI-categorise items. Works on top-level FlowItem fields and on `data.*`. Everything except categorisation is
deterministic; dates are parsed forgivingly ("15 Dec 2026", "2026-12-15T23:59", "Dec 15, 2026 11:59 PM")."""

from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

from dateutil import parser as dateparser
from pydantic import BaseModel

from app.platform.flow import FlowItem

TOP_LEVEL = ("id", "title", "url", "text", "summary", "source_name", "published_at", "image_url")
_NUMBER = re.compile(r"^\s*[-+]?[\d,]*\.?\d+\s*$")


# ---------------------------------------------------------------- field access
def _path(path: str) -> tuple[str, list[str]]:
    p = path.strip()
    if p.startswith("data."):
        return "data", p[5:].split(".")
    if p in TOP_LEVEL:
        return p, []
    return "data", p.split(".")  # bare names refer to data fields


def get_field(item: FlowItem, path: str) -> Any:
    root, rest = _path(path)
    if root != "data":
        return getattr(item, root)
    cur: Any = item.data
    for part in rest:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def set_field(item: FlowItem, path: str, value: Any) -> None:
    root, rest = _path(path)
    if root != "data":
        setattr(item, root, value if root not in ("title", "text") else str(value or ""))
        return
    cur = item.data
    for part in rest[:-1]:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = cur[part] = {}
        cur = nxt
    cur[rest[-1]] = value


def pop_field(item: FlowItem, path: str) -> Any:
    root, rest = _path(path)
    if root != "data":
        value = getattr(item, root)
        return value
    cur: Any = item.data
    for part in rest[:-1]:
        cur = cur.get(part) if isinstance(cur, dict) else None
    return cur.pop(rest[-1], None) if isinstance(cur, dict) else None


# ---------------------------------------------------------------- value parsing
def as_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str) and _NUMBER.match(value):
        try:
            return float(value.replace(",", ""))
        except ValueError:
            return None
    return None


def as_date(value: Any) -> date | None:
    """Robust date parsing; returns None for anything that is not clearly a date."""
    if isinstance(value, datetime):
        return value.astimezone(UTC).date() if value.tzinfo else value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or not re.search(r"\d", value) or as_number(value) is not None and len(value.strip()) < 6:
        return None
    text = re.sub(r"\b(IST|UTC|GMT|PST|EST|CET)\b", "", value, flags=re.I).strip()
    try:
        return dateparser.parse(text, default=datetime(datetime.now(UTC).year, 1, 1)).date()
    except (ValueError, OverflowError, TypeError):
        try:
            return dateparser.parse(text, fuzzy=True, default=datetime(datetime.now(UTC).year, 1, 1)).date()
        except (ValueError, OverflowError, TypeError):
            return None


def _text(value: Any) -> str:
    if isinstance(value, list):
        return " ".join(str(v) for v in value).lower()
    return str(value if value is not None else "").lower()


def _compare(a: Any, b: Any) -> float | None:
    """a - b for numbers, else day difference for dates, else None (incomparable)."""
    na, nb = as_number(a), as_number(b)
    if na is not None and nb is not None:
        return na - nb
    da, db = as_date(a), as_date(b)
    if da is not None and db is not None:
        return float((da - db).days)
    return None


def passes(item: FlowItem, f: dict[str, Any], today: date) -> bool:
    value = get_field(item, f["field"])
    op, target = f["op"], f.get("value")
    if op == "exists":
        present = value not in (None, "", [], {})
        return present if target is None or bool(target) else not present
    if op == "date_after_today":
        d = as_date(value)
        return d is not None and d >= today
    if op == "date_within_days":
        d = as_date(value)
        return d is not None and today <= d <= today + timedelta(days=float(target or 0))
    if op in ("contains", "not_contains"):
        if isinstance(value, list):
            found = any(_text(target) in _text(v) for v in value)
        else:
            found = _text(target) in _text(value)
        return found if op == "contains" else not found
    if op in ("eq", "neq"):
        diff = _compare(value, target)
        same = diff == 0 if diff is not None else _text(value).strip() == _text(target).strip()
        return same if op == "eq" else not same
    diff = _compare(value, target)
    if diff is None:
        return False
    return {"gt": diff > 0, "gte": diff >= 0, "lt": diff < 0, "lte": diff <= 0}[op]


def sort_key(value: Any) -> tuple[int, Any]:
    n = as_number(value)
    if n is not None:
        return (0, n)
    d = as_date(value)
    if d is not None:
        return (1, d.toordinal())
    return (2, _text(value))


# ---------------------------------------------------------------- AI categorisation
async def categorise(ctx, items: list[FlowItem], categories: list[str], field: str) -> list[FlowItem]:
    allowed = {c.lower(): c for c in categories}

    class Category(BaseModel):
        category: str

    def check(out: Category) -> list[str]:
        return [] if out.category.strip().lower() in allowed else [f"category must be exactly one of: {', '.join(categories)}"]

    async def one(item: FlowItem) -> FlowItem:
        out = await ctx.generate(
            task="categorize",
            system="You classify items into exactly one of the given categories.",
            prompt=f"Categories: {', '.join(categories)}\n\nPick the single best category for this item.\n\n"
            f"TITLE: {item.title}\nDETAILS: {json.dumps(item.data, ensure_ascii=False, default=str)[:1500]}\n{(item.summary or item.text or '')[:1500]}",
            schema=Category,
            context={"categories": categories, "title": item.title, "text": f"{item.title} {item.summary or ''} {item.text} {json.dumps(item.data, default=str)}"},
            temperature=0.0,
            max_tokens=60,
            validate=check,
        )
        set_field(item, field if field.startswith("data.") else f"data.{field}", allowed[out.category.strip().lower()])
        return item

    return await ctx.for_each(items, one, label="Categorise")


# ---------------------------------------------------------------- step
async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    today = datetime.now(UTC).date()
    n_in = len(items)
    renames: dict[str, str] = json.loads(cfg.get("rename_fields") or "{}")
    sets: dict[str, Any] = json.loads(cfg.get("set_fields") or "{}")
    filters: list[dict[str, Any]] = json.loads(cfg.get("filters") or "[]")

    for item in items:
        for src, dst in renames.items():
            value = pop_field(item, src)
            if value is not None:
                set_field(item, dst, value)
        for path, value in sets.items():
            set_field(item, path, value)

    dedupe = [p for p in cfg.get("dedupe_by") or [] if p]
    if dedupe:
        seen: dict[str, set[str]] = {p: set() for p in dedupe}
        unique = []
        for item in items:
            keys = {}
            for p in dedupe:
                v = get_field(item, p)
                if v not in (None, "", []):
                    keys[p] = (item.canonical_url or "") if p == "url" else re.sub(r"\s+", " ", _text(v)).strip()
            if any(k and k in seen[p] for p, k in keys.items()):
                continue
            for p, k in keys.items():
                if k:
                    seen[p].add(k)
            unique.append(item)
        if len(unique) < len(items):
            await ctx.log(f"Removed {len(items) - len(unique)} duplicate(s) by {', '.join(dedupe)}")
        items = unique

    for f in filters:
        before = len(items)
        items = [it for it in items if passes(it, f, today)]
        if len(items) < before:
            await ctx.log(f"Filter {f['field']} {f['op']}{' ' + str(f.get('value')) if f.get('value') is not None else ''}: removed {before - len(items)}")

    if cfg.get("sort_by"):
        path = cfg["sort_by"]
        present = [it for it in items if get_field(it, path) not in (None, "", [])]
        missing = [it for it in items if get_field(it, path) in (None, "", [])]
        present.sort(key=lambda it: sort_key(get_field(it, path)), reverse=cfg.get("sort_order") == "desc")
        items = present + missing

    if int(cfg.get("limit") or 0) > 0:
        items = items[: int(cfg["limit"])]

    rules: list[dict[str, Any]] = json.loads(cfg.get("assign_rules") or "[]")
    if rules:
        assigned = 0
        for item in items:
            rule = next((r for r in rules if passes(item, r["if"], today)), None)
            if rule is not None:
                for path, value in rule["set"].items():
                    set_field(item, path, value)
                assigned += 1
        await ctx.log(f"Assignment rules matched {assigned} of {len(items)} item(s)")

    if cfg.get("ai_categorize") and cfg.get("categories") and items:
        items = await categorise(ctx, items, cfg["categories"], cfg.get("category_field") or "category")

    await ctx.log(f"Data Cleaner: {n_in} in, {len(items)} out")
    return items
