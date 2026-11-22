"""page_watcher: snapshot a page (or one element by CSS selector) per agent + URL and emit only what changed since
the previous check, with before/after text and a unified-diff summary. Noise (whitespace, optionally dates/times
and other numbers) is normalised away so counters and timestamps do not trigger false alarms. The first check is
a baseline."""

from __future__ import annotations

import difflib
import re
from typing import Any

from app.core.db import session_factory, utcnow
from app.platform.extract import page_text, page_title, parse_html, select
from app.platform.flow import FlowItem
from app.platform.kinds.common import fetch
from app.services.integrations import kv_get, kv_set
from app.services.text import normalize_space, sha256

DATE_TIME = re.compile(
    r"\b(\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:am|pm)?|\d{4}-\d{2}-\d{2}(?:t[\d:.+z-]+)?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|"
    r"(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?|"
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?|\d+\s+(?:seconds?|minutes?|hours?|days?)\s+ago)\b",
    re.I,
)
SNAPSHOT_CAP = 20_000


def normalise(text: str, *, ignore_dates: bool, ignore_numbers: bool) -> str:
    lines = []
    for line in text.splitlines():
        t = line
        if ignore_dates:
            t = DATE_TIME.sub("<time>", t)
        if ignore_numbers:
            t = re.sub(r"\d+", "#", t)
        t = normalize_space(t)
        if t:
            lines.append(t)
    return "\n".join(lines)


def diff_summary(before: str, after: str, max_lines: int = 40) -> tuple[str, int, int]:
    diff = list(difflib.unified_diff(before.splitlines(), after.splitlines(), "before", "after", lineterm="", n=0))
    body = [d for d in diff if not d.startswith(("---", "+++", "@@"))]
    added = sum(1 for d in body if d.startswith("+"))
    removed = sum(1 for d in body if d.startswith("-"))
    return "\n".join(body[:max_lines]) + (f"\n… {len(body) - max_lines} more line(s)" if len(body) > max_lines else ""), added, removed


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    urls = list(dict.fromkeys([s["url"] for s in cfg.get("sources") or []] + [it.url for it in items if it.url]))
    selector = (cfg.get("selector") or "").strip()
    ignore_dates, ignore_numbers = cfg.get("ignore_dates", True), cfg.get("ignore_numbers", False)
    out: list[FlowItem] = []
    baselines = unchanged = 0
    for url in urls:
        await ctx.check_cancel()
        res = await fetch(ctx, url)
        if res is None:
            continue
        tree = parse_html(res.text)
        if selector:
            nodes = select(tree, selector)
            if not nodes:
                await ctx.log(f"{url}: nothing matches '{selector}' (layout changed?)", "warn")
            raw = "\n".join(page_text(f"<div>{_html(n)}</div>") for n in nodes)
        else:
            raw = page_text(res.text, cap=SNAPSHOT_CAP)
        current = normalise(raw, ignore_dates=ignore_dates, ignore_numbers=ignore_numbers)[:SNAPSHOT_CAP]
        key = f"watch:{ctx.agent.id}:{sha256(url + '|' + selector)[:16]}"
        async with session_factory()() as db:
            previous = await kv_get(db, ctx.tenant.id, key)
            if ctx.persist:
                await kv_set(db, ctx.tenant.id, key, {"url": url, "selector": selector, "text": current, "hash": sha256(current),
                                                     "at": utcnow().isoformat()})
                await db.commit()
        title = page_title(tree) or url
        if previous is None:
            baselines += 1
            await ctx.log(f"Baseline saved for {url}" + (f" ({selector})" if selector else "") + "; changes will be reported from the next check")
            if not cfg.get("emit_on_first_run"):
                continue
            out.append(FlowItem(title=f"Now watching: {title}", url=res.final_url or url, text=current,
                                data={"before": None, "after": current[:4000], "diff": None, "status": "baseline"}))
            continue
        if previous.get("hash") == sha256(current):
            unchanged += 1
            continue
        summary, added, removed = diff_summary(previous.get("text") or "", current)
        if added + removed < int(cfg.get("min_changed_lines", 1)):
            unchanged += 1
            continue
        out.append(FlowItem(
            title=f"Changed: {title}", url=res.final_url or url, text=current, summary=f"{added} line(s) added, {removed} removed",
            data={"before": (previous.get("text") or "")[:4000], "after": current[:4000], "diff": summary, "added_lines": added,
                  "removed_lines": removed, "previous_check": previous.get("at"), "status": "changed"},
        ))
        await ctx.log(f"Change on {url}: +{added} / -{removed} line(s)")
    await ctx.log(f"Checked {len(urls)} page(s): {len([o for o in out if o.data.get('status') == 'changed'])} changed, {unchanged} unchanged, "
                  f"{baselines} new baseline(s)" + ("" if ctx.persist else " (test run: snapshots not saved)"))
    return out


def _html(node: Any) -> str:
    from lxml import html as lxml_html

    return lxml_html.tostring(node, encoding="unicode")
