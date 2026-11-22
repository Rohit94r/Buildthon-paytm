"""document_reader: open PDFs from links (brochures, fee notices, circulars, annual reports), extract their text
page by page within the fetcher's size cap, and optionally pull out the fields you ask for with AI extraction."""

from __future__ import annotations

from typing import Any
from urllib.parse import unquote, urlsplit

from app.platform.extract import ai_fields
from app.platform.flow import FlowItem
from app.platform.tools import invoke
from app.services.canonical import publisher_from_url
from app.services.fetcher import FetchError
from app.services.text import truncate_words


def _filename(url: str) -> str:
    name = unquote(urlsplit(url).path.rstrip("/").split("/")[-1]) or url
    return name.rsplit(".", 1)[0].replace("-", " ").replace("_", " ").strip() or name


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    urls = [s["url"] for s in cfg.get("sources") or []]
    if cfg.get("read_item_links", True):
        urls += [it.url for it in items if it.url and (it.url.lower().split("?")[0].endswith(".pdf") or not cfg.get("sources"))]
    urls = list(dict.fromkeys(urls))
    fields = cfg.get("extract_fields") or []
    out: list[FlowItem] = []
    for url in urls[: int(cfg.get("max_documents", 20))]:
        await ctx.check_cancel()
        try:
            doc = await invoke(ctx, "doc.read", summary=lambda d: {"pages": d["pages"], "bytes": d["bytes"]}, url=url,
                               max_pages=int(cfg.get("max_pages", 20)))
        except (FetchError, ValueError) as exc:
            await ctx.log(f"{url}: {exc}", "warn")
            continue
        text = doc["text"]
        item = FlowItem(title=doc.get("title") or _filename(url), url=doc["url"], text=text, summary=truncate_words(text, 300, ellipsis=True) or None,
                        source_name=publisher_from_url(url), data={"pages": doc["pages"], "pages_read": doc["pages_read"], "author": doc.get("author")})
        if not text.strip():
            item.flags.append("no_text_layer")
            await ctx.log(f"{url}: no extractable text (scanned PDF?); OCR is not available", "warn")
        elif fields:
            item.data.update(await ai_fields(ctx, fields, title=item.title, text=text, url=url))
        await ctx.log(f"Read '{item.title[:60]}': {doc['pages_read']} of {doc['pages']} page(s), {len(text.split())} words")
        out.append(item)
    return out
