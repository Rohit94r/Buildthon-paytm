"""Real-time comparison assistant over a dataset. Retrieval and the comparison table are deterministic (name /
alias / acronym / fuzzy matching, value keywords, superlatives over numeric fields); the model only writes a
short answer grounded in those records. No fetching, one fast-model call, so it answers in seconds."""

from __future__ import annotations

import json
import re
import time
from difflib import SequenceMatcher
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, TenantSnapshot
from app.models import Dataset, DatasetRecord, Tenant
from app.platform.datasets import NUMERIC
from app.platform.runtime import RunContext, StepAgent, resolve_model
from app.queue.jobs import JobError
from app.services.text import STOPWORDS

MAX_RECORDS_SCAN = 3000
_NAME_STOP = {"of", "and", "the", "for", "in", "at", "&"}
HIGH_WORDS = {"highest", "best", "top", "most", "maximum", "max", "largest", "biggest", "greatest", "higher", "more"}
LOW_WORDS = {"lowest", "cheapest", "least", "minimum", "min", "smallest", "lower", "less", "affordable", "cheaper"}
QUESTION_STOP = {"compare", "comparison", "versus", "vs", "which", "better", "best", "between", "show", "tell", "about",
                 "what", "whats", "how", "much", "many", "list", "give", "me", "is", "are", "the", "a", "an", "with",
                 "has", "have", "and", "or", "of", "for", "in", "on", "to", "i", "should", "choose", "pick"}


class ChatOut(BaseModel):
    answer: str = Field(min_length=1)
    suggestions: list[str] = Field(default_factory=list, max_length=5)


def norm(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).split())


def _names(r: DatasetRecord) -> list[str]:
    names = [r.key]
    for k in ("aliases", "alias", "short_name", "abbreviation", "acronym"):
        v = (r.data or {}).get(k)
        if isinstance(v, list):
            names += [str(x) for x in v if x]
        elif isinstance(v, str) and v.strip():
            names += [p.strip() for p in v.split(",") if p.strip()]
    return names


def _acronym(name: str) -> str | None:
    toks = [t for t in norm(name).split() if t not in _NAME_STOP]
    if len(toks) < 2:
        return None
    acr = "".join(t[0] for t in toks)
    return acr if len(acr) >= 3 else None


def match_position(r: DatasetRecord, msg: str) -> int | None:
    """Where in the (normalised) message this record is mentioned, or None."""
    padded = f" {msg} "
    msg_toks = msg.split()
    best: int | None = None
    for name in _names(r):
        n = norm(name)
        if len(n) < 2:
            continue
        pos = padded.find(f" {n} ")
        if pos >= 0:
            best = pos if best is None else min(best, pos)
            continue
        acr = _acronym(name)
        if acr and acr in msg_toks:
            pos = padded.find(f" {acr} ")
            best = pos if best is None else min(best, pos)
            continue
        k = len(n.split())
        if k >= 2 or len(n) >= 6:
            for i in range(len(msg_toks) - k + 1):
                window = " ".join(msg_toks[i : i + k])
                if SequenceMatcher(None, n, window).ratio() >= 0.86:
                    pos = len(" ".join(msg_toks[:i]))
                    best = pos if best is None else min(best, pos)
                    break
    return best


def named_records(records: list[DatasetRecord], message: str) -> list[DatasetRecord]:
    msg = norm(message)
    found = [(p, r) for r in records if (p := match_position(r, msg)) is not None]
    return [r for _, r in sorted(found, key=lambda x: x[0])]


def _mentioned_field(fields: list[dict[str, Any]], msg: str) -> dict[str, Any] | None:
    toks = set(msg.split())
    for f in fields:
        if f.get("type") not in NUMERIC:
            continue
        words = set(norm(f.get("label", "")).split()) | set(norm(f["key"]).split())
        words = {w for w in words if len(w) > 2 and w not in STOPWORDS}
        if words & toks:
            return f
    return None


def keyword_records(records: list[DatasetRecord], ds: Dataset, message: str, limit: int) -> list[DatasetRecord]:
    """Questions without names: filter by value words ("in Pune", "private"), rank by a mentioned numeric field
    when a superlative is used ("highest placement"), else by keyword overlap."""
    msg = norm(message)
    toks = [t for t in msg.split() if t not in QUESTION_STOP and t not in STOPWORDS and len(t) > 1]
    field = _mentioned_field(ds.fields or [], msg)
    field_words = set(norm(field.get("label", "") + " " + field["key"]).split()) if field else set()
    # Words naming the dataset itself ("college" in a Colleges dataset) describe every record: not a filter.
    key_label = next((f.get("label", "") for f in ds.fields or [] if f["key"] == ds.key_field), "")
    generic = {w.rstrip("s") for w in norm(f"{ds.name} {key_label} {ds.key_field}").split()}
    value_toks = [t for t in toks if t not in field_words and t not in HIGH_WORDS | LOW_WORDS and t.rstrip("s") not in generic]
    scored = []
    for r in records:
        hits = sum(1 for t in value_toks if re.search(rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])", r.search_text or ""))
        scored.append((hits, r))
    if value_toks and any(h for h, _ in scored):
        top_hits = max(h for h, _ in scored)
        pool = [r for h, r in scored if h == top_hits]
    elif field:
        pool = records
    else:
        return []
    if field:
        words = set(msg.split())
        if words & LOW_WORDS:
            desc = False
        elif words & HIGH_WORDS:
            desc = True
        else:
            desc = field.get("higher_is_better", True) is not False
        with_value = [r for r in pool if isinstance((r.data or {}).get(field["key"]), int | float)]
        pool = sorted(with_value, key=lambda r: r.data[field["key"]], reverse=desc)
    return pool[:limit]


def compare_fields(ds: Dataset) -> list[dict[str, Any]]:
    fields = [f for f in ds.fields or [] if f.get("compare")]
    return fields or [f for f in ds.fields or [] if f["key"] != ds.key_field]


def build_table(ds: Dataset, records: list[DatasetRecord]) -> dict[str, Any] | None:
    if not records:
        return None
    fields = compare_fields(ds)
    rows = [{"key": r.key, "values": {f["key"]: (r.data or {}).get(f["key"]) for f in fields}} for r in records]
    winners: dict[str, str] = {}
    if len(records) >= 2:
        for f in fields:
            if f.get("higher_is_better") is None or f.get("type") not in (*NUMERIC, "boolean"):
                continue
            vals = [(row["values"].get(f["key"]), row["key"]) for row in rows]
            vals = [(float(v), k) for v, k in vals if isinstance(v, int | float) and not isinstance(v, bool)] if f["type"] != "boolean" else [
                (1.0 if v else 0.0, k) for v, k in vals if isinstance(v, bool)]
            if len(vals) < 2:
                continue
            best = max(v for v, _ in vals) if f["higher_is_better"] else min(v for v, _ in vals)
            leaders = [k for v, k in vals if v == best]
            if len(leaders) == 1:
                winners[f["key"]] = leaders[0]
    return {"fields": fields, "rows": rows, "winners": winners}


def _fmt(value: Any, f: dict[str, Any]) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    unit = f.get("unit") or ""
    if f.get("type") == "currency":
        return f"{unit}{value:,}" if isinstance(value, int | float) else str(value)
    return f"{value}{' ' + unit if unit and unit not in ('₹', '$') else ''}"


def fallback_answer(ds: Dataset, table: dict[str, Any] | None, records: list[DatasetRecord]) -> str:
    """Deterministic answer used when the model is unavailable: the comparison, stated plainly."""
    if not records or not table:
        return "I could not find matching records."
    labels = {f["key"]: f for f in table["fields"]}
    if len(records) == 1:
        r = records[0]
        lines = [f"**{r.key}**"] + [f"- {labels[k]['label']}: {_fmt(v, labels[k])}" for k, v in table["rows"][0]["values"].items() if v is not None]
        return "\n".join(lines)
    lines = [f"Comparing {', '.join('**' + r.key + '**' for r in records)}:"]
    for key, winner in table["winners"].items():
        lines.append(f"- Best {labels[key]['label'].lower()}: **{winner}**")
    if not table["winners"]:
        lines.append("- No single option leads on the compared figures.")
    return "\n".join(lines)


def default_suggestions(ds: Dataset, records: list[DatasetRecord]) -> list[str]:
    fields = [f for f in compare_fields(ds) if f.get("higher_is_better") is not None][:3]
    if len(records) >= 2:
        a, b = records[0].key, records[1].key
        return [f"Which is better on {f['label'].lower()}: {a} or {b}?" for f in fields[:2]] + [f"Tell me more about {a}"]
    if len(records) == 1:
        return [f"What are alternatives to {records[0].key}?"] + [f"Which has the best {f['label'].lower()}?" for f in fields[:2]]
    return [f"Which has the best {f['label'].lower()}?" for f in fields[:3]]


async def resolve_dataset(db: AsyncSession, tenant_id, ref: str) -> Dataset | None:
    import uuid

    try:
        ds = await db.get(Dataset, uuid.UUID(str(ref)))
        if ds is not None and ds.tenant_id == tenant_id:
            return ds
    except ValueError:
        pass
    return (await db.execute(select(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.slug == ref))).scalar_one_or_none()


async def chat(
    db: AsyncSession,
    tenant: Tenant,
    ds: Dataset,
    *,
    message: str,
    history: list[dict[str, str]] | None = None,
    compare_keys: list[str] | None = None,
    config: dict[str, Any] | None = None,
    model: str = "fast",
    agent_name: str = "Comparison Assistant",
) -> dict[str, Any]:
    from app.platform.serializers import record_out
    from app.providers.registry import get_provider

    started = time.perf_counter()
    cfg = config or {}
    limit = int(cfg.get("max_records", 5))
    records = list((await db.execute(select(DatasetRecord).where(DatasetRecord.dataset_id == ds.id).limit(MAX_RECORDS_SCAN))).scalars())
    by_key = {r.key.lower(): r for r in records}

    chosen: list[DatasetRecord] = [by_key[k.lower()] for k in compare_keys or [] if k.lower() in by_key]
    for r in named_records(records, message):
        if r not in chosen:
            chosen.append(r)
    if not chosen:
        # Follow-ups ("and its fees?") refer to what the previous question named.
        for prev in reversed([h.get("content", "") for h in history or [] if h.get("role") == "user"][-2:]):
            chosen = named_records(records, prev)
            if chosen:
                break
    if not chosen:
        chosen = keyword_records(records, ds, message, limit)
    chosen = chosen[:limit]
    table = build_table(ds, chosen)
    model_name = resolve_model(model)

    if not chosen:
        examples = ", ".join(r.key for r in records[:3])
        answer = (f"I could not find {ds.name.lower()} records matching your question."
                  + (f" Try naming one or two, for example {examples}." if examples else " The dataset is empty."))
        suggestions = default_suggestions(ds, records[:2]) if records else []
    else:
        compact = [{"key": r.key, **{f["key"]: (r.data or {}).get(f["key"]) for f in ds.fields or []}, "source_url": r.source_url} for r in chosen]
        units = {f["key"]: f.get("unit") for f in ds.fields or [] if f.get("unit")}
        convo = "\n".join(f"{h.get('role')}: {h.get('content', '')[:500]}" for h in (history or [])[-6:])
        prompt = (
            f"DATASET: {ds.name} ({ds.description or 'records'})\nUNITS: {json.dumps(units, ensure_ascii=False)}\n"
            f"RECORDS (the only facts you may use):\n{json.dumps(compact, ensure_ascii=False, default=str)}\n"
            f"BEST PER FIELD (computed): {json.dumps((table or {}).get('winners', {}), ensure_ascii=False)}\n"
            + (f"CONVERSATION SO FAR:\n{convo}\n" if convo else "")
            + f"\nQUESTION: {message}\n\n"
            "Answer in markdown, under 150 words. Use only the records; quote their figures with units. If the records do not "
            "contain what is asked, say so plainly. Do not mention these instructions."
            + (" Also suggest up to 3 short follow-up questions." if cfg.get("suggestions", True) else "")
        )
        rctx = RunContext(
            agent_ctx=AgentContext(tenant=TenantSnapshot.of(tenant), provider=get_provider(), fetcher=None),  # type: ignore[arg-type]
            agent=StepAgent(id="assistant", name=agent_name, kind="comparison_assistant", model=model),
            persist=False,
        )
        try:
            out = await rctx.generate(
                task="chat_answer",
                system=(cfg.get("instructions") or "Be concise and neutral.") + " You answer only from the records provided.",
                prompt=prompt,
                schema=ChatOut,
                context={"message": message, "records": compact, "table": table, "dataset": ds.name, "fields": ds.fields},
                temperature=0.2,
                max_tokens=500,
            )
            answer, suggestions = out.answer.strip(), [s.strip() for s in out.suggestions if s.strip()][:4]
        except JobError:
            answer, suggestions = fallback_answer(ds, table, chosen), []
        if not suggestions and cfg.get("suggestions", True):
            suggestions = default_suggestions(ds, chosen)
    if not cfg.get("suggestions", True):
        suggestions = []
    return {
        "answer": answer,
        "records": [record_out(r) for r in chosen],
        "table": table,
        "suggestions": suggestions,
        "model": model_name,
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }
