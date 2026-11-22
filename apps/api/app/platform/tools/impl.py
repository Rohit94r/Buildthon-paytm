"""Tool implementations (registered into the registry by key). Each reuses the existing services: the polite
Fetcher, feed/sitemap/article parsers, SEO rules, image picker, dataset upserts, connections."""

from __future__ import annotations

import uuid
from typing import Any
from urllib.parse import quote_plus

from sqlalchemy import select

from app.core.db import session_factory
from app.models import Connection, ContentItem, Dataset, DatasetRecord, Tenant
from app.platform.tools import tool
from app.services.fetcher import FetchError, FetchResult


# ---------------------------------------------------------------- web
@tool("web.fetch")
async def web_fetch(rctx, url: str, robots: bool = True) -> FetchResult:
    return await rctx.fetcher.get(url, respect_robots=robots, use_cache=False)


@tool("rss.read")
async def rss_read(rctx, url: str) -> list[Any]:
    from app.services.feeds import parse_rss

    res = await rctx.fetcher.get(url, respect_robots=False, use_cache=False)  # feeds are published for syndication
    return parse_rss(res.text)


@tool("sitemap.read")
async def sitemap_read(rctx, url: str, limit: int = 500) -> list[str]:
    from app.services.htmlmeta import parse_sitemap

    res = await rctx.fetcher.get(url, respect_robots=False, use_cache=False)
    urls, children = parse_sitemap(res.text)
    for child in children[:3]:
        if len(urls) >= limit:
            break
        try:
            sub = await rctx.fetcher.get(child, respect_robots=False, use_cache=False)
        except FetchError:
            continue
        urls += parse_sitemap(sub.text)[0]
    return list(dict.fromkeys(urls))[:limit]


@tool("html.extract")
async def html_extract(rctx, html: str, url: str) -> Any:
    from app.services.extractor import extract

    return extract(html, url)


@tool("web.search")
async def web_search(rctx, query: str, engine: str = "google_news", region: str = "IN", language: str = "en", hours: int = 168,
                     limit: int = 8) -> list[dict[str, Any]]:
    """News search through Google News RSS (published for syndication). DuckDuckGo Lite is used only when its
    robots.txt allows our user agent; a refusal falls back to Google News instead of being bypassed."""
    from app.platform.kinds.news_monitor import google_news_url
    from app.services.feeds import parse_rss

    if engine == "duckduckgo":
        url = f"https://lite.duckduckgo.com/lite/?q={quote_plus(query)}"
        try:
            res = await rctx.fetcher.get(url, respect_robots=True, use_cache=False)
            return _ddg_results(res.text)[:limit]
        except FetchError as exc:
            await rctx.log(f"DuckDuckGo not used ({exc}); searching Google News instead", "warn")
    res = await rctx.fetcher.get(google_news_url(query, region=region, language=language, hours=hours), respect_robots=False, use_cache=False)
    return [
        {"title": r.title, "url": r.url, "summary": r.summary, "publisher": r.publisher,
         "published_at": r.published_at.isoformat() if r.published_at else None}
        for r in parse_rss(res.text)[:limit]
    ]


def _ddg_results(html: str) -> list[dict[str, Any]]:
    from app.platform.extract import parse_html
    from app.services.text import normalize_space

    out = []
    for a in parse_html(html).xpath("//a[contains(@class,'result-link')]"):
        href = a.get("href") or ""
        if href.startswith("http"):
            out.append({"title": normalize_space(a.text_content()), "url": href, "summary": "", "publisher": None, "published_at": None})
    return out


@tool("image.discover")
async def image_discover(rctx, url: str) -> dict[str, Any] | None:
    from app.services.canonical import publisher_from_url
    from app.services.images import candidates_from_html, pick_image

    res = await rctx.fetcher.get(url, respect_robots=True, use_cache=True)
    best = pick_image(candidates_from_html(res.text, res.final_url or url))
    if best is None:
        return None
    return {"url": best.url, "width": best.width, "height": best.height, "source": best.source,
            "credit": publisher_from_url(res.final_url or url), "page": res.final_url or url}


@tool("seo.analyze")
async def seo_analyze(rctx, html: str, url: str, status: int = 200) -> dict[str, Any]:
    from app.platform.kinds.site_auditor import analyze_page

    return analyze_page(html, url, status)


# ---------------------------------------------------------------- ai
@tool("ai.extract")
async def ai_extract(rctx, fields: list[dict[str, Any]], title: str | None, text: str, url: str | None, many: bool = False) -> Any:
    from app.platform.extract import model_fields, model_rows

    if many:
        return await model_rows(rctx, fields, title=title, text=text, url=url)
    return await model_fields(rctx, fields, title=title, text=text, url=url)


@tool("model.generate")
async def model_generate(rctx, **kwargs: Any) -> Any:
    return await rctx.generate(**kwargs)


# ---------------------------------------------------------------- data
async def _dataset(rctx, dataset_id: str) -> Dataset:
    async with session_factory()() as db:
        try:
            ds = await db.get(Dataset, uuid.UUID(str(dataset_id)))
        except ValueError:
            ds = None
    if ds is None or ds.tenant_id != rctx.tenant.id:
        raise ValueError("The dataset no longer exists; pick another one in the agent settings")
    return ds


@tool("dataset.read")
async def dataset_read(rctx, dataset_id: str, keys: list[str] | None = None, limit: int = 3000) -> list[DatasetRecord]:
    ds = await _dataset(rctx, dataset_id)
    async with session_factory()() as db:
        stmt = select(DatasetRecord).where(DatasetRecord.dataset_id == ds.id)
        if keys is not None:
            stmt = stmt.where(DatasetRecord.key.in_(keys[:1000]))
        return list((await db.execute(stmt.limit(limit))).scalars())


@tool("dataset.upsert")
async def dataset_upsert(rctx, dataset_id: str, records: list[tuple[dict[str, Any], str | None]], update_existing: bool = True) -> dict[str, int]:
    from app.platform.datasets import upsert_record
    from app.platform.plans import QuotaExceeded, check_records

    counts = {"created": 0, "updated": 0, "skipped": 0}
    if not rctx.persist:
        counts["skipped"] = len(records)
        return counts
    ds = await _dataset(rctx, dataset_id)
    async with session_factory()() as db:
        dsr = await db.get(Dataset, ds.id)
        tenant = await db.get(Tenant, ds.tenant_id)
        for data, url in records:
            try:
                existing = None
                from app.platform.datasets import coerce_record, record_key

                key = record_key(dsr, coerce_record(dsr, data))
                if key is not None:
                    existing = (await db.execute(select(DatasetRecord.id).where(DatasetRecord.dataset_id == dsr.id, DatasetRecord.key == key))).scalar_one_or_none()
                if existing is None:
                    await check_records(db, tenant)
                outcome, _ = await upsert_record(db, dsr, data, source_url=url, update_existing=update_existing)
            except QuotaExceeded as exc:
                counts["skipped"] += 1
                await rctx.log(f"Record skipped: {exc.message}", "warn")
                continue
            except ValueError as exc:
                counts["skipped"] += 1
                await rctx.log(f"Skipped a record: {exc}", "warn")
                continue
            counts[outcome] += 1
        await db.commit()
    rctx.outputs["dataset_changes"] = {"dataset_id": str(ds.id), "created": counts["created"], "updated": counts["updated"]}
    return counts


@tool("content.save")
async def content_save(rctx, item: Any, persona: str | None = None) -> str | None:
    from app.platform.content import save_content

    await save_content(rctx, item, persona=persona)
    if item.content_id:
        rctx.outputs.setdefault("content_ids", [])
        if item.content_id not in rctx.outputs["content_ids"]:
            rctx.outputs["content_ids"].append(item.content_id)
    return item.content_id


# ---------------------------------------------------------------- side effects
async def _connections(rctx, ids: list[str]) -> list[Connection]:
    from app.platform.publishing import load_connections

    async with session_factory()() as db:
        return await load_connections(db, rctx.tenant.id, ids)


@tool("publish.connection")
async def publish_connection(rctx, content_id: str, connection_ids: list[str]) -> list[dict[str, Any]]:
    from app.platform.publishing import publish_to, schedule_retry

    if not rctx.persist:
        return [{"dry_run": True}]
    async with session_factory()() as db:
        content = await db.get(ContentItem, uuid.UUID(content_id))
        tenant = await db.get(Tenant, rctx.tenant.id)
        from app.platform.publishing import load_connections

        conns = await load_connections(db, rctx.tenant.id, connection_ids)
        results = await publish_to(db, tenant, content, conns, rctx.fetcher)
        retry = [r["connection_id"] for r in results if r["status"] == "failed" and r.get("retryable")]
        if retry:
            await schedule_retry(db, content, retry)
        await db.commit()
    return results


@tool("http.request")
async def http_request(rctx, connection_id: str, method: str, path: str, body: Any) -> dict[str, Any]:
    from app.platform.connections import rest_request

    if not rctx.persist:
        return {"dry_run": True, "status": None, "body": body}
    conns = await _connections(rctx, [connection_id])
    if not conns:
        raise ValueError("The REST API connection no longer exists")
    return await rest_request(conns[0], method, path, body, rctx.fetcher)


@tool("notify.send")
async def notify_send(rctx, connection_id: str, text: str, subject: str | None = None) -> dict[str, Any]:
    from app.platform.connections import send_message

    if not rctx.persist:
        return {"dry_run": True}
    conns = await _connections(rctx, [connection_id])
    if not conns:
        raise ValueError("The notification connection no longer exists")
    return await send_message(conns[0], text, subject=subject, fetcher=rctx.fetcher)


# ---------------------------------------------------------------- wave 3 tools
@tool("links.collect")
async def links_collect(rctx, html: str, url: str, same_site: bool = True, include: list[str] | None = None,
                        exclude: list[str] | None = None) -> list[tuple[str, str]]:
    from app.platform.extract import parse_html
    from app.platform.webparse import keep_url, page_links

    return [(u, t) for u, t in page_links(parse_html(html), url, same_site=same_site) if keep_url(u, include or [], exclude or [])]


PDF_ACCEPT = ("application/pdf", "application/x-pdf", "application/octet-stream", "binary/octet-stream")


@tool("doc.read")
async def doc_read(rctx, url: str, max_pages: int = 20) -> dict[str, Any]:
    """PDFs only through this tool: the fetcher's default accept list stays HTML/feeds/JSON. The size cap applies."""
    import asyncio
    import io

    res = await rctx.fetcher.get(url, respect_robots=True, use_cache=False, accept=PDF_ACCEPT)
    data = res.content
    if not data.startswith(b"%PDF"):
        raise ValueError(f"{url} is not a PDF file")

    def parse() -> dict[str, Any]:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError

        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted and not reader.decrypt(""):
                raise ValueError("The PDF is password-protected")
            pages = reader.pages
            texts = [(pages[i].extract_text() or "").strip() for i in range(min(len(pages), max_pages))]
            meta = reader.metadata or {}
            return {"text": "\n\n".join(t for t in texts if t), "pages": len(pages), "pages_read": len(texts),
                    "title": (meta.get("/Title") or "").strip() or None, "author": (meta.get("/Author") or "").strip() or None}
        except PdfReadError as exc:
            raise ValueError(f"Could not read the PDF: {exc}") from exc

    out = await asyncio.to_thread(parse)
    out["bytes"] = len(data)
    out["url"] = res.final_url or url
    return out


@tool("image.search")
async def image_search(rctx, provider: str, query: str, limit: int = 10) -> list[dict[str, Any]]:
    import json

    from app.platform import media as m

    url = m.openverse_url(query, limit) if provider == "openverse" else m.wikimedia_url(query, limit)
    res = await rctx.fetcher.get(url, respect_robots=False, use_cache=True, accept=("application/json",))
    data = json.loads(res.text or "{}")
    return (m.parse_openverse if provider == "openverse" else m.parse_wikimedia)(data)[:limit]


IMAGE_ACCEPT = ("image/jpeg", "image/png", "image/webp", "image/gif")
IMAGE_MAX_BYTES = 2 * 1024 * 1024


@tool("image.hash")
async def image_hash(rctx, url: str) -> dict[str, Any]:
    from app.platform.media import dhash

    res = await rctx.fetcher.get(url, respect_robots=False, use_cache=False, accept=IMAGE_ACCEPT, max_bytes=IMAGE_MAX_BYTES)
    return {"hash": dhash(res.content), "bytes": res.content}


@tool("suggest.keywords")
async def suggest_keywords(rctx, query: str, language: str = "en", region: str = "IN") -> list[str]:
    """Keyless autocomplete: Google's Firefox endpoint, then Bing's OpenSearch endpoint. Both return
    ["query", ["suggestion", …]]. Cached by the fetcher; failures return [] (never fatal)."""
    import json

    accept = ("application/json", "text/javascript", "application/x-javascript", "text/plain", "application/x-suggestions+json")
    for url in (f"https://suggestqueries.google.com/complete/search?client=firefox&hl={language}&gl={region}&q={quote_plus(query)}",
                f"https://api.bing.com/osjson.aspx?query={quote_plus(query)}&language={language}"):
        try:
            res = await rctx.fetcher.get(url, respect_robots=False, use_cache=True, accept=accept)
            data = json.loads(res.text)
            if isinstance(data, list) and len(data) > 1 and isinstance(data[1], list):
                return [s for s in data[1] if isinstance(s, str)]
        except (FetchError, ValueError, TypeError):
            continue
    return []


# ---------------------------------------------------------------- sponsor APIs (Beyond 9TO5)
@tool("serpapi.search")
async def serpapi_search(rctx, query: str, engine: str = "google", location: str = "", gl: str = "in", hl: str = "en",
                         count: int = 10) -> list[dict[str, Any]]:
    from app.services.sponsor import serpapi_search as _search

    hits = await _search(query, engine=engine, location=location, gl=gl, hl=hl, count=int(count))
    return [h.out() for h in hits]


@tool("serpapi.extract")
async def serpapi_extract(rctx, url: str) -> dict[str, Any]:
    from app.services.sponsor import serpapi_extract as _extract

    return await _extract(url)


@tool("you.search")
async def you_search(rctx, query: str, count: int = 5, freshness: str = "") -> list[dict[str, Any]]:
    from app.services.sponsor import you_search as _search

    hits = await _search(query, count=int(count), freshness=str(freshness or ""))
    return [h.out() for h in hits]


@tool("you.answer")
async def you_answer(rctx, query: str, country: str = "IN", language: str = "EN") -> dict[str, Any]:
    from app.services.sponsor import you_answer as _answer

    return (await _answer(query, country=country, language=language)).out()
