"""change_detector: compare incoming items with a dataset's records by key -> new / changed / unchanged with
field-level diffs (e.g. a fee or price changed). Optionally writes the changes back to the dataset."""

from __future__ import annotations

from typing import Any

from app.platform.datasets import coerce_record, record_key
from app.platform.flow import FlowItem
from app.platform.kinds.dataset_builder import item_record, load_dataset
from app.platform.tools import invoke

EMIT = {"all": ("new", "changed", "unchanged"), "new": ("new",), "changed": ("changed",), "new_and_changed": ("new", "changed")}


def _same(a: Any, b: Any) -> bool:
    if isinstance(a, int | float) and isinstance(b, int | float) and not isinstance(a, bool):
        return abs(float(a) - float(b)) < 1e-9
    if isinstance(a, list) and isinstance(b, list):
        return sorted(map(str, a)) == sorted(map(str, b))
    return a == b


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    ds = await load_dataset(ctx, cfg["dataset"])
    fields = cfg.get("compare_fields") or [f["key"] for f in ds.fields or [] if f["key"] != ds.key_field]
    prepared = []
    for it in items:
        data = coerce_record(ds, item_record(it, ds))
        prepared.append((it, data, record_key(ds, data)))
    keys = [k for _, _, k in prepared if k]
    existing = {r.key: r for r in await invoke(ctx, "dataset.read", summary=lambda r: {"records": len(r)}, dataset_id=str(ds.id), keys=keys)}
    out, counts, writes = [], {"new": 0, "changed": 0, "unchanged": 0, "no_key": 0}, []
    wanted = EMIT.get(cfg.get("emit", "new_and_changed"), EMIT["new_and_changed"])
    for it, data, key in prepared:
        if key is None:
            counts["no_key"] += 1
            continue
        rec = existing.get(key)
        if rec is None:
            status, diff = "new", {}
        else:
            diff = {f: {"old": (rec.data or {}).get(f), "new": data.get(f)} for f in fields
                    if data.get(f) is not None and not _same((rec.data or {}).get(f), data.get(f))}
            status = "changed" if diff else "unchanged"
        counts[status] += 1
        it.data["change"] = {"status": status, "key": key, "diff": diff}
        if status != "unchanged":
            writes.append((data, it.url))
        if status in wanted:
            out.append(it)
    if cfg.get("update_dataset") and writes:
        await invoke(ctx, "dataset.upsert", summary=lambda c: dict(c), dataset_id=str(ds.id), records=writes, update_existing=True)
    await ctx.log(f"'{ds.name}': {counts['new']} new, {counts['changed']} changed, {counts['unchanged']} unchanged"
                  + (f", {counts['no_key']} without a key" if counts["no_key"] else ""))
    return out
