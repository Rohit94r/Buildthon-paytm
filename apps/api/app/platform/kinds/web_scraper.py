"""web_scraper: websites, feeds, sitemaps and JSON endpoints -> items.

Modes
- auto: published structured data first (JSON-LD/microdata/Open Graph mapped onto your field names), then the model
  reads the page and returns one row per entry, from plain field names. No selectors needed.
- tables: every HTML table becomes rows (header detection, numbers/money cleaned).
- structured: only published structured data (Product, Event, JobPosting, Article, Review, Organization…).
- crawl: same-site breadth-first crawl (sitemap seeding, depth + page limits): title, text, headings, links, meta.
- css: your selectors (advanced).
Listing pages follow "next page" links (rel=next, "Next"/"›", ?page=N) up to max_pages, and can open every
entry's detail page. Everything goes through the tool registry: robots.txt, rate limits and the SSRF guard apply."""

from __future__ import annotations

import json
from collections import Counter
from typing import Any
from urllib.parse import urljoin, urlsplit

from app.platform.extract import (
    ai_fields,
    ai_rows,
    css_fields,
    page_text,
    page_title,
    parse_html,
    select,
    select_value,
)
from app.platform.flow import FlowItem
from app.platform.kinds.common import fetch, read_article, recent
from app.platform.tools import invoke
from app.platform.webparse import (
    keep_url,
    map_entity,
    next_page,
    page_meta,
    parse_tables,
    structured_entities,
)
from app.services.canonical import canonicalize, publisher_from_url
from app.services.feeds import FeedParseError, parse_rss, strip_html
from app.services.fetcher import FetchError
from app.services.text import normalize_space, truncate_words


def _looks_like_feed(text: str) -> bool:
    head = text.lstrip()[:400].lower()
    return (head.startswith("<?xml") and ("<rss" in head or "<feed" in head)) or head.startswith(("<rss", "<feed"))


def _json_items(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [d for d in data if isinstance(d, dict)]
    if isinstance(data, dict):
        for key in ("items", "data", "results", "articles", "posts", "entries", "records", "hackathons", "events", "products", "jobs"):
            if isinstance(data.get(key), list):
                return [d for d in data[key] if isinstance(d, dict)]
        lists = [v for v in data.values() if isinstance(v, list) and v and isinstance(v[0], dict)]
        if lists:
            return lists[0]
    return []


def _dig(d: dict[str, Any], path: str) -> Any:
    cur: Any = d
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _first(d: dict[str, Any], keys: tuple[str, ...]) -> Any:
    return next((d[k] for k in keys if d.get(k)), None)


def _from_feed(text: str) -> list[FlowItem]:
    return [
        FlowItem(title=r.title, url=r.url, summary=r.summary or None, text=r.summary or "", source_name=r.publisher,
                 published_at=r.published_at.isoformat() if r.published_at else None, image_url=r.image_url, data={"_needs_text": True})
        for r in parse_rss(text)
    ]


def _from_json(text: str, src_url: str, fields: list[dict[str, Any]]) -> list[FlowItem]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{src_url} did not return JSON") from exc
    out = []
    for d in _json_items(data):
        title = _first(d, ("title", "name", "headline", "label"))
        if not title:
            continue
        url = _first(d, ("url", "link", "href", "permalink"))
        body = _first(d, ("text", "content", "body", "description", "summary", "excerpt"))
        image = _first(d, ("image", "image_url", "thumbnail", "thumbnail_url"))
        data_fields = {f["key"]: _dig(d, f.get("selector") or f["key"]) for f in fields}
        out.append(FlowItem(
            title=strip_html(str(title))[:300], url=urljoin(src_url, str(url)) if url else None,
            text=strip_html(body) if isinstance(body, str) else "", summary=truncate_words(strip_html(body), 300) if isinstance(body, str) else None,
            published_at=str(_first(d, ("published_at", "date", "pubDate", "created_at")) or "") or None,
            image_url=image if isinstance(image, str) else None, source_name=publisher_from_url(src_url),
            data={**{k: v for k, v in data_fields.items() if v is not None}, "_needs_text": True},
        ))
    return out


def _from_css_listing(tree: Any, base_url: str, cfg: dict[str, Any]) -> list[FlowItem]:
    out = []
    for el in select(tree, cfg["item_selector"]):
        link = select_value(el, (cfg.get("link_selector") or "a[href]") + "@href", base_url)
        if not link and el.tag == "a":
            link = urljoin(base_url, el.get("href") or "")
        link_el = select(el, cfg.get("link_selector") or "a[href]")
        title = normalize_space(link_el[0].text_content()) if link_el else normalize_space(el.text_content())[:200]
        if title:
            data = css_fields(el, cfg.get("extract_fields") or [], base_url)
            data["_needs_text"] = True  # writers downstream need the entry's full text
            out.append(FlowItem(title=title[:300], url=link or None, text=normalize_space(el.text_content()),
                                source_name=publisher_from_url(base_url), data=data))
    return out


def _entity_item(ent: dict[str, Any], page_url: str, fields: list[dict[str, Any]], page_name: str | None) -> FlowItem:
    from app.platform.webparse import flatten

    data = map_entity(ent, fields) if fields else {k: v for k, v in list(flatten(ent).items())[:40]}
    types = ent.get("@type")
    data["_type"] = types[0] if isinstance(types, list) and types else types
    name = ent.get("name") or ent.get("headline") or data.get("name") or page_name or page_url
    url = ent.get("url") if isinstance(ent.get("url"), str) else None
    image = ent.get("image")
    image = image[0] if isinstance(image, list) and image else image
    image = image.get("url") if isinstance(image, dict) else image
    return FlowItem(title=normalize_space(str(name))[:300], url=urljoin(page_url, url) if url else page_url,
                    text=normalize_space(str(ent.get("description") or ""))[:4000], summary=None,
                    image_url=image if isinstance(image, str) else None, source_name=publisher_from_url(page_url), data=data)


def _detail_links(tree: Any, page_url: str, pattern: str, same_site: bool) -> list[str]:
    """Links to entries' own pages: the pattern if given, else same-site links deeper than the listing page that
    sit outside navigation, header and footer."""
    from app.platform.webparse import page_links

    links = page_links(tree, page_url, same_site=same_site)
    if pattern:
        return [u for u, _ in links if keep_url(u, [pattern], [])]
    nav = {canonicalize(urljoin(page_url, h)) for h in tree.xpath("//nav//a/@href|//header//a/@href|//footer//a/@href")}
    base_path = urlsplit(page_url).path.rstrip("/")
    out = []
    for u, text in links:
        path = urlsplit(u).path.rstrip("/")
        if u in nav or len(text) < 3 or path == base_path or not path.startswith(base_path) or path.count("/") <= base_path.count("/"):
            continue
        out.append(u)
    return out


class Scrape:
    """One run of the scraper: config, counters for the summary log, and the per-page handlers."""

    def __init__(self, ctx, cfg: dict[str, Any]) -> None:
        self.ctx, self.cfg = ctx, cfg
        self.fields: list[dict[str, Any]] = cfg.get("extract_fields") or []
        self.mode: str = cfg.get("mode") or "auto"
        self.max_items = int(cfg.get("max_items") or 50)
        self.max_pages = int(cfg.get("max_pages") or 5)
        self.stats: Counter[str] = Counter()
        self.items: list[FlowItem] = []

    @property
    def full(self) -> bool:
        return len(self.items) >= self.max_items

    async def detail(self, url: str) -> FlowItem | None:
        res = await fetch(self.ctx, url)
        if res is None:
            return None
        tree = parse_html(res.text)
        final = res.final_url or url
        ents, kind = structured_entities(tree)
        if ents and self.mode in ("auto", "structured"):
            item = _entity_item(ents[0], final, self.fields, page_title(tree))
            self.stats[f"structured:{kind}"] += 1
        else:
            item = FlowItem(title=page_title(tree) or final, url=final, text=page_text(res.text, cap=6000), source_name=publisher_from_url(final))
            if self.mode == "css":
                item.data.update(css_fields(tree, self.fields, final))
        missing = [f for f in self.fields if item.data.get(f["key"]) in (None, "", [])]
        if missing and self.mode == "auto":
            item.data.update({k: v for k, v in (await ai_fields(self.ctx, missing, title=item.title, text=page_text(res.text), url=final)).items()
                              if v not in (None, "", [])})
            self.stats["ai"] += 1
        return item

    async def listing(self, res, tree: Any) -> list[FlowItem]:
        page_url = res.final_url
        name = page_title(tree)
        if self.mode == "tables":
            out = []
            for t in parse_tables(tree):
                self.stats["tables"] += 1
                for row in t["rows"]:
                    label = next((str(v) for v in row.values() if isinstance(v, str) and v), name or page_url)
                    out.append(FlowItem(title=label[:300], url=page_url, source_name=publisher_from_url(page_url),
                                        data={**row, "_table": t["caption"] or f"Table {t['index'] + 1}"}))
            return out
        if self.mode == "css":
            if self.cfg.get("item_selector"):
                found = _from_css_listing(tree, page_url, self.cfg)
            else:
                found = [FlowItem(title=name or page_url, url=page_url, text=page_text(res.text), data=css_fields(tree, self.fields, page_url))]
            if self.cfg.get("detail_follow"):
                return [d for d in [await self.detail(i.url) for i in found[: self.max_items] if i.url] if d] or found
            return found
        if self.cfg.get("detail_follow"):
            links = _detail_links(tree, page_url, self.cfg.get("detail_link_pattern") or "", self.cfg.get("same_site", True))
            out = []
            for link in links[: max(0, self.max_items - len(self.items))]:
                await self.ctx.check_cancel()
                d = await self.detail(link)
                if d is not None:
                    out.append(d)
            return out
        ents, kind = structured_entities(tree)
        if ents and (self.mode == "structured" or not self.fields or any(map_entity(e, self.fields) for e in ents)):
            self.stats[f"structured:{kind}"] += 1
            return [_entity_item(e, page_url, self.fields, name) for e in ents]
        if self.mode == "structured":
            return []
        if self.fields:
            rows = await ai_rows(self.ctx, self.fields, title=name, text=page_text(res.text), url=page_url)
            self.stats["ai"] += 1
            if rows:
                title_key = next((f["key"] for f in self.fields if f["key"] in ("name", "title", "product", "job_title", "event")), self.fields[0]["key"])
                return [FlowItem(title=str(r.get(title_key) or name or page_url)[:300], url=str(r.get("url")) if r.get("url") else page_url,
                                 source_name=publisher_from_url(page_url), data=r) for r in rows if any(v not in (None, "", []) for v in r.values())]
        return [FlowItem(title=name or page_url, url=page_url, text=page_text(res.text), source_name=publisher_from_url(page_url),
                         data={"_needs_text": True})]

    async def paginate(self, start: str) -> None:
        url: str | None = start
        seen: set[str] = set()
        page = 0
        while url and page < self.max_pages and not self.full:
            await self.ctx.check_cancel()
            if canonicalize(url) in seen:
                break
            seen.add(canonicalize(url))
            res = await fetch(self.ctx, url)
            if res is None:
                break
            page += 1
            if _looks_like_feed(res.text):
                found = _from_feed(res.text)
                self.items.extend(found)
                await self.ctx.log(f"{url}: feed with {len(found)} item(s)")
                return
            tree = parse_html(res.text)
            res.final_url = res.final_url or url
            found = await self.listing(res, tree)
            self.items.extend(found)
            await self.ctx.log(f"Page {page}/{self.max_pages}: {len(found)} item(s) from {res.final_url}")
            url = next_page(tree, res.final_url) if self.cfg.get("follow_pagination", True) else None

    async def crawl(self, start: str) -> None:
        depth_max = int(self.cfg.get("crawl_depth", 1))
        queue: list[tuple[str, int]] = [(start, 0)]
        try:
            seeds = await invoke(self.ctx, "sitemap.read", summary=lambda r: {"urls": len(r)}, url=urljoin(start, "/sitemap.xml"), limit=self.max_pages * 2)
            host = urlsplit(start).hostname
            queue += [(u, 1) for u in seeds if urlsplit(u).hostname == host]
            if seeds:
                await self.ctx.log(f"Sitemap: {len(seeds)} URL(s) to seed the crawl")
        except FetchError:
            pass
        seen: set[str] = set()
        while queue and self.stats["crawled"] < self.max_pages and not self.full:
            await self.ctx.check_cancel()
            url, depth = queue.pop(0)
            key = canonicalize(url)
            if key in seen:
                continue
            seen.add(key)
            res = await fetch(self.ctx, url)
            if res is None or not res.text:
                continue
            self.stats["crawled"] += 1
            tree = parse_html(res.text)
            final = res.final_url or url
            links = await invoke(self.ctx, "links.collect", summary=lambda r: {"links": len(r)}, html=res.text, url=final,
                                 same_site=self.cfg.get("same_site", True))
            text = page_text(res.text)
            self.items.append(FlowItem(title=page_title(tree) or final, url=final, text=text, source_name=publisher_from_url(final),
                                       data={**page_meta(tree), "links": [u for u, _ in links][:50], "link_count": len(links),
                                             "word_count": len(text.split()), "depth": depth}))
            if depth < depth_max:
                queue += [(u, depth + 1) for u, _ in links if canonicalize(u) not in seen]
        await self.ctx.log(f"Crawled {self.stats['crawled']} page(s) from {start}")


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    s = Scrape(ctx, cfg)
    for src in cfg.get("sources") or []:
        if s.full:
            break
        url, stype = src["url"], src.get("type", "html")
        try:
            if stype == "rss":
                found = await invoke(ctx, "rss.read", summary=lambda r: {"items": len(r)}, url=url)
                s.items.extend(FlowItem(title=r.title, url=r.url, summary=r.summary or None, text=r.summary or "", source_name=r.publisher,
                                        published_at=r.published_at.isoformat() if r.published_at else None, image_url=r.image_url,
                                        data={"_needs_text": True}) for r in found)
                await ctx.log(f"{url}: feed with {len(found)} item(s)")
            elif stype == "sitemap":
                urls = await invoke(ctx, "sitemap.read", summary=lambda r: {"urls": len(r)}, url=url, limit=s.max_items * 2)
                await ctx.log(f"{url}: sitemap with {len(urls)} URL(s)")
                for u in urls:
                    if s.full:
                        break
                    if s.mode in ("auto", "structured", "tables", "css"):
                        d = await s.detail(u) if s.mode != "tables" else None
                        if s.mode == "tables":
                            res = await fetch(ctx, u)
                            if res is not None:
                                res.final_url = res.final_url or u
                                s.items.extend(await s.listing(res, parse_html(res.text)))
                        elif d is not None:
                            s.items.append(d)
            elif stype == "json":
                res = await fetch(ctx, url)
                if res is not None:
                    found = _from_json(res.text, res.final_url or url, s.fields)
                    s.items.extend(found)
                    await ctx.log(f"{url}: {len(found)} item(s) from JSON")
            elif s.mode == "crawl":
                await s.crawl(url)
            else:
                await s.paginate(url)
        except (FeedParseError, FetchError, ValueError) as exc:
            await ctx.log(f"{url}: {exc}", "warn")

    # De-duplicate (feeds syndicate the same story; tables repeat rows), apply recency, cap.
    seen: set[str] = {it.canonical_url for it in items if it.canonical_url}
    out: list[FlowItem] = []
    for it in s.items:
        if s.mode == "tables":
            key = json.dumps(it.data, sort_keys=True, default=str)
        else:
            # Rows read from one listing page share its URL, so the title is part of the identity.
            key = f"{canonicalize(it.url)}|{it.title.lower()}" if it.url else it.title.lower()
        if key in seen or not recent(it, float(cfg.get("max_age_hours") or 0)):
            continue
        seen.add(key)
        out.append(it)
        if len(out) >= s.max_items:
            break

    # Feed / JSON entries: read the article and fill requested fields.
    needs = [it for it in out if it.data.pop("_needs_text", False)]
    if needs and cfg.get("follow_links", True):
        for it in needs:
            await ctx.check_cancel()
            if it.url and urlsplit(it.url).scheme in ("http", "https"):
                await read_article(ctx, it)
    if s.fields and s.mode == "auto" and needs:
        async def fill(it: FlowItem) -> FlowItem:
            missing = [f for f in s.fields if it.data.get(f["key"]) in (None, "", [])]
            if missing:
                it.data.update({k: v for k, v in (await ai_fields(ctx, missing, title=it.title, text=it.text or it.summary or "", url=it.url)).items()
                                if v not in (None, "", [])})
            return it

        await ctx.for_each(needs, fill, label="AI extraction")

    notes = [f"Used {k.split(':', 1)[1]} data on {n} page(s)" for k, n in s.stats.items() if k.startswith("structured:")]
    if s.stats["ai"]:
        notes.append(f"AI extraction on {s.stats['ai']} page(s)")
    if s.stats["tables"]:
        notes.append(f"{s.stats['tables']} table(s) read")
    for n in notes:
        await ctx.log(n)
    await ctx.log(f"Collected {len(out)} item(s) from {len(cfg.get('sources') or [])} source(s)")
    return [*items, *out]
