"""link_collector: gather URLs from start pages and sitemaps, follow links up to 2 clicks deep, keep only those
matching include patterns (glob or regex) and not matching exclude patterns, canonicalise them (tracking
parameters stripped) and de-duplicate. One item per URL, ready for a scraper, reader or watcher."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from app.platform.flow import FlowItem
from app.platform.kinds.common import fetch
from app.platform.tools import invoke
from app.platform.webparse import keep_url
from app.services.canonical import canonicalize, publisher_from_url
from app.services.fetcher import FetchError


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    include, exclude = cfg.get("include_patterns") or [], cfg.get("exclude_patterns") or []
    max_links, depth_max, same_site = int(cfg.get("max_links", 200)), int(cfg.get("depth", 0)), cfg.get("same_site", True)
    starts = list(cfg.get("start_urls") or []) + [it.url for it in items if it.url]
    found: dict[str, dict[str, Any]] = {}

    def add(url: str, title: str, origin: str, depth: int, via: str) -> None:
        key = canonicalize(url)
        if key not in found and keep_url(key, include, exclude) and len(found) < max_links:
            found[key] = {"title": title, "found_on": origin, "depth": depth, "via": via}

    for sm in cfg.get("sitemaps") or []:
        try:
            urls = await invoke(ctx, "sitemap.read", summary=lambda r: {"urls": len(r)}, url=sm, limit=max_links * 5)
        except FetchError as exc:
            await ctx.log(f"Sitemap {sm}: {exc}", "warn")
            continue
        before = len(found)
        for u in urls:
            add(u, "", sm, 0, "sitemap")
        await ctx.log(f"Sitemap {sm}: {len(urls)} URL(s), {len(found) - before} kept")

    visited: set[str] = set()
    frontier = [(u, 0) for u in starts]
    pages = 0
    while frontier and len(found) < max_links:
        await ctx.check_cancel()
        url, depth = frontier.pop(0)
        if canonicalize(url) in visited:
            continue
        visited.add(canonicalize(url))
        res = await fetch(ctx, url)
        if res is None:
            continue
        pages += 1
        final = res.final_url or url
        links = await invoke(ctx, "links.collect", summary=lambda r: {"links": len(r)}, html=res.text, url=final, same_site=same_site)
        before = len(found)
        for link, text in links:
            add(link, text, final, depth, "page")
            if depth < depth_max and urlsplit(link).hostname == urlsplit(final).hostname and canonicalize(link) not in visited:
                frontier.append((link, depth + 1))
        await ctx.log(f"{final}: {len(links)} link(s), {len(found) - before} new match(es)")

    out = [FlowItem(title=v["title"] or u, url=u, source_name=publisher_from_url(u), data={k: v[k] for k in ("found_on", "depth", "via")})
           for u, v in found.items()]
    await ctx.log(f"Collected {len(out)} URL(s) from {pages} page(s)" + (f" and {len(cfg.get('sitemaps') or [])} sitemap(s)" if cfg.get("sitemaps") else ""))
    return out
