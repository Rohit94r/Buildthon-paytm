"""dataset_builder: structured records into a dataset, upserted by the dataset's key field.

`scrape` mode reads pages itself: listing pages (link selector -> up to N detail pages) or direct URLs, then
extracts fields with CSS selectors or the model. `pipeline_items` mode saves the items earlier steps produced
(item.data plus title/url/summary/text mapped onto same-named fields) — e.g. scraped, cleaned and rewritten
listings that a client site then reads through the public datasets API."""

from __future__ import annotations

import uuid
from typing import Any
from urllib.parse import urljoin

from app.core.db import session_factory
from app.models import Dataset
from app.platform.extract import ai_fields, css_fields, page_text, page_title, parse_html, select
from app.platform.flow import FlowItem
from app.platform.kinds.common import fetch


async def load_dataset(ctx, dataset_id: str) -> Dataset:
    async with session_factory()() as db:
        try:
            ds = await db.get(Dataset, uuid.UUID(str(dataset_id)))
        except ValueError:
            ds = None
    if ds is None or ds.tenant_id != ctx.tenant.id:
        raise ValueError("The target dataset no longer exists; pick another one in the agent settings")
    return ds


def item_record(item: FlowItem, ds: Dataset) -> dict[str, Any]:
    """Map a FlowItem onto dataset fields: data.* first, then top-level item fields with the same key."""
    keys = {f["key"] for f in ds.fields or []}
    record = {k: v for k, v in item.data.items() if k in keys or k in ("aliases", "category")}
    article = item.formats.get("article") or item.formats.get("blog_post")
    top = {"title": item.title, "name": item.title, "url": item.url, "summary": item.summary, "text": item.text,
           "description": article or item.summary or item.text, "source_name": item.source_name,
           "published_at": item.published_at, "image_url": item.image_url}
    for k in keys:
        if record.get(k) in (None, "", []) and top.get(k) not in (None, ""):
            record[k] = top[k]
    return record


async def _save(ctx, ds: Dataset, records: list[tuple[dict[str, Any], str | None]], update_existing: bool) -> dict[str, int]:
    from app.platform.tools import invoke

    return await invoke(ctx, "dataset.upsert", summary=lambda c: dict(c), dataset_id=str(ds.id), records=records,
                        update_existing=update_existing)


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    ds = await load_dataset(ctx, cfg["dataset"])
    update_existing = bool(cfg.get("update_existing", True))

    if cfg.get("source_mode") == "pipeline_items":
        records = [(item_record(it, ds), it.url) for it in items]
        counts = await _save(ctx, ds, records, update_existing)
        verb = "Would save" if not ctx.persist else "Saved"
        await ctx.log(f"{verb} {len(items)} item(s) to '{ds.name}': {counts['created']} new, {counts['updated']} updated, {counts['skipped']} skipped")
        return items

    fields = cfg.get("extract_fields") or [
        {"key": f["key"], "label": f.get("label", f["key"]), "type": f.get("type", "text"), **({"unit": f["unit"]} if f.get("unit") else {})}
        for f in ds.fields or []
    ]
    mode = cfg.get("mode", "ai")
    max_pages = int(cfg.get("max_pages", 10))

    pages: list[str] = []
    for src in cfg.get("sources") or []:
        if cfg.get("link_selector"):
            res = await fetch(ctx, src["url"])
            if res is None:
                continue
            tree = parse_html(res.text)
            links = [urljoin(res.final_url or src["url"], a.get("href")) for a in select(tree, cfg["link_selector"]) if a.get("href")]
            await ctx.log(f"{src['url']}: {len(links)} detail link(s)")
            pages += links
        else:
            pages.append(src["url"])
    pages += [it.url for it in items if it.url]
    pages = list(dict.fromkeys(p for p in pages if p.startswith(("http://", "https://"))))[:max_pages]
    if not pages:
        await ctx.log("No pages to read: add sources, or put this agent after a collector", "warn")
        return items

    records: list[tuple[dict[str, Any], str | None]] = []
    out: list[FlowItem] = []
    for url in pages:
        await ctx.check_cancel()
        await ctx.agent_ctx.beat()
        res = await fetch(ctx, url)
        if res is None:
            continue
        final = res.final_url or url
        tree = parse_html(res.text)
        if mode == "css":
            data = css_fields(tree, fields, final)
        else:
            try:
                data = await ai_fields(ctx, fields, title=page_title(tree), text=page_text(res.text), url=final)
            except Exception as exc:  # one unreadable page must not stop the crawl
                await ctx.log(f"Extraction failed for {url}: {str(exc)[:200]}", "warn")
                continue
        if data.get(ds.key_field) in (None, ""):
            await ctx.log(f"{url}: no value for key field '{ds.key_field}', skipped", "warn")
            continue
        records.append((data, final))
        out.append(FlowItem(title=str(data[ds.key_field]), url=final, text=page_text(res.text, cap=2000), data=data))

    counts = await _save(ctx, ds, records, update_existing)
    await ctx.log(f"'{ds.name}': read {len(pages)} page(s); {counts['created']} new, {counts['updated']} updated, {counts['skipped']} skipped")
    return out
