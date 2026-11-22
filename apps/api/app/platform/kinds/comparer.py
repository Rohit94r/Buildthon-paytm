"""comparer: match the same thing (product, college, plan, service) across sources by fuzzy name matching, build
a side-by-side comparison table with the best value per field (higher or lower is better), and optionally save
it as content (markdown table + summary). Works on incoming items or on a dataset."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from app.core.db import utcnow
from app.platform.content import sync_content
from app.platform.flow import FlowItem
from app.platform.kinds.data_transform import as_number, get_field
from app.platform.tools import invoke
from app.services.canonical import publisher_from_url

NOISE = {"the", "a", "an", "and", "of", "for", "with", "ltd", "limited", "pvt", "private", "inc", "llc", "co", "new", "official"}


def norm_name(text: str) -> str:
    toks = [t for t in re.sub(r"[^a-z0-9]+", " ", str(text).lower()).split() if t not in NOISE]
    return " ".join(toks)


def similarity(a: str, b: str) -> float:
    """0–100. rapidfuzz's token_sort_ratio when installed, else difflib on sorted tokens."""
    try:
        from rapidfuzz import fuzz

        return float(fuzz.token_sort_ratio(a, b))
    except ImportError:
        return SequenceMatcher(None, " ".join(sorted(a.split())), " ".join(sorted(b.split()))).ratio() * 100


def parse_fields(specs: list[str]) -> list[dict[str, Any]]:
    """"price:lower", "rating:higher", "city" -> field specs."""
    out = []
    for spec in specs:
        key, _, direction = spec.partition(":")
        key = key.strip()
        if not key:
            continue
        d = direction.strip().lower()
        hib = True if d in ("higher", "high", "max", "up") else False if d in ("lower", "low", "min", "down") else None
        out.append({"key": key, "label": key.split(".")[-1].replace("_", " ").capitalize(), "higher_is_better": hib})
    return out


def _source_of(it: FlowItem) -> str:
    return it.source_name or (publisher_from_url(it.url) if it.url else "source")


def _fmt(v: Any) -> str:
    if v is None:
        return "–"
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, int | float):
        return f"{v:,}"
    return str(v)


def table_markdown(fields: list[dict[str, Any]], rows: list[dict[str, Any]], winners: dict[str, str]) -> str:
    head = "| Name | " + " | ".join(f["label"] for f in fields) + " | Sources |"
    sep = "|" + "---|" * (len(fields) + 2)
    lines = [head, sep]
    for r in rows:
        cells = [(f"**{_fmt(r['values'].get(f['key']))}** ✓" if winners.get(f["key"]) == r["key"] else _fmt(r["values"].get(f["key"]))) for f in fields]
        lines.append(f"| {r['key']} | " + " | ".join(cells) + f" | {len(r['sources'])} |")
    return "\n".join(lines)


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    match_field = cfg.get("match_field") or "title"
    fields = parse_fields(cfg.get("compare_fields") or [])
    if not fields:
        raise ValueError("List the fields to compare, e.g. price:lower, rating:higher")
    threshold = float(cfg.get("fuzzy_threshold", 85))
    rows: list[FlowItem] = list(items)
    if cfg.get("dataset"):
        records = await invoke(ctx, "dataset.read", summary=lambda r: {"records": len(r)}, dataset_id=cfg["dataset"])
        rows += [FlowItem(title=r.key, url=r.source_url, source_name="dataset", data=dict(r.data or {})) for r in records]

    groups: list[dict[str, Any]] = []
    for it in rows:
        name = get_field(it, match_field) or it.title
        n = norm_name(name)
        if not n:
            continue
        best = max(groups, key=lambda g: similarity(n, g["norm"]), default=None)
        if best is not None and similarity(n, best["norm"]) >= threshold:
            best["members"].append(it)
        else:
            groups.append({"norm": n, "name": str(name).strip(), "members": [it]})

    table_rows, out = [], []
    for g in groups:
        values, best_source, sources = {}, {}, []
        for it in g["members"]:
            src = {"source": _source_of(it), "url": it.url, "values": {f["key"]: get_field(it, f["key"]) for f in fields}}
            sources.append(src)
        for f in fields:
            cands = [(s["values"][f["key"]], s["source"]) for s in sources if s["values"][f["key"]] not in (None, "", [])]
            if not cands:
                values[f["key"]] = None
                continue
            nums = [(as_number(v), s) for v, s in cands if as_number(v) is not None]
            if f["higher_is_better"] is not None and nums:
                v, s = (max if f["higher_is_better"] else min)(nums, key=lambda x: x[0])
                values[f["key"]], best_source[f["key"]] = v, s
            else:
                values[f["key"]], best_source[f["key"]] = cands[0]
        images = [img for it in g["members"] for img in (it.data.get("images") or [])][:6]
        table_rows.append({"key": g["name"], "values": values, "sources": sources})
        out.append(FlowItem(title=g["name"], url=g["members"][0].url, image_url=next((it.image_url for it in g["members"] if it.image_url), None),
                            data={"values": values, "best_source": best_source, "sources": sources, "matched": len(g["members"]),
                                  **({"images": images} if images else {})}))

    winners: dict[str, str] = {}
    if len(table_rows) >= 2:
        for f in fields:
            if f["higher_is_better"] is None:
                continue
            vals = [(as_number(r["values"].get(f["key"])), r["key"]) for r in table_rows]
            vals = [(v, k) for v, k in vals if v is not None]
            if len(vals) >= 2:
                best = (max if f["higher_is_better"] else min)(v for v, _ in vals)
                leaders = [k for v, k in vals if v == best]
                if len(leaders) == 1:
                    winners[f["key"]] = leaders[0]
    for it in out:
        it.data["winner_of"] = [k for k, w in winners.items() if w == it.title]
    table = {"fields": [{"key": f["key"], "label": f["label"], "type": "number" if f["higher_is_better"] is not None else "text", "compare": True,
                         **({"higher_is_better": f["higher_is_better"]} if f["higher_is_better"] is not None else {})} for f in fields],
             "rows": [{"key": r["key"], "values": r["values"]} for r in table_rows], "winners": winners}
    multi = sum(1 for g in groups if len(g["members"]) > 1)
    summary = (f"{len(rows)} entr{'y' if len(rows) == 1 else 'ies'} from {len({_source_of(i) for i in rows})} source(s) matched into "
               f"{len(groups)} item(s); {multi} found in more than one source.")
    wins = "; ".join(f"best {next(f['label'] for f in fields if f['key'] == k).lower()}: {v}" for k, v in winners.items())
    markdown = "\n\n".join(x for x in (summary + (f" {wins.capitalize()}." if wins else ""), table_markdown(fields, table_rows, winners)) if x)
    ctx.outputs["report"] = markdown
    ctx.outputs["table"] = table
    await ctx.log(summary)
    if cfg.get("save_content", True) and table_rows:
        title = (cfg.get("title") or "Comparison {{date}}").replace("{{date}}", utcnow().date().isoformat())
        report = FlowItem(title=title, text=markdown, summary=summary, formats={"article": markdown},
                          image_url=next((i.image_url for i in out if i.image_url), None),
                          data={"tags": ["comparison"], "table": table, "images": [img for i in out for img in (i.data.get("images") or [])][:8]})
        await sync_content(ctx, report)
    return out
