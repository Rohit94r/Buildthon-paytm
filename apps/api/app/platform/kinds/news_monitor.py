"""news_monitor: keywords/topics -> recent, de-duplicated stories from Google News search feeds and the
workspace's own RSS feeds (parsed with the newsroom's feed parser)."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote_plus

from app.platform.flow import FlowItem
from app.platform.kinds.common import parse_dt, read_article, recent
from app.platform.tools import invoke
from app.services.feeds import FeedParseError
from app.services.fetcher import FetchError


def google_news_url(query: str, *, region: str, language: str, hours: int) -> str:
    when = f"{max(1, hours // 24)}d" if hours >= 24 else f"{max(1, hours)}h"
    lang = (language or "en").lower()
    region = (region or "IN").upper()
    return (
        f"https://news.google.com/rss/search?q={quote_plus(f'{query} when:{when}')}"
        f"&hl={lang}-{region}&gl={region}&ceid={region}:{lang}"
    )


def _mentions(text: str, phrases: list[str]) -> bool:
    low = text.lower()
    return any(re.search(r"(?<!\w)" + re.escape(p.strip('"').lower()) + r"(?!\w)", low) for p in phrases if p.strip('"'))


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    keywords: list[str] = cfg.get("keywords") or []
    if not keywords and not cfg.get("feeds"):
        raise ValueError("Add keywords to search for, or feeds to follow")
    exclude: list[str] = cfg.get("exclude_keywords") or []
    hours = int(cfg.get("max_age_hours") or 24)
    found: list[tuple[FlowItem, str | None]] = []

    feeds: list[tuple[str, str | None]] = []
    if cfg.get("use_google_news", True):
        feeds += [(google_news_url(k, region=cfg.get("region", "IN"), language=cfg.get("language", "en"), hours=hours), k) for k in keywords]
    feeds += [(f, None) for f in cfg.get("feeds") or []]

    for url, keyword in feeds:
        await ctx.check_cancel()
        try:
            raw = await invoke(ctx, "rss.read", summary=lambda r: {"items": len(r)}, url=url)
        except (FeedParseError, FetchError) as exc:
            await ctx.log(f"{url}: {exc}", "warn")
            continue
        kept = 0
        for r in raw:
            blob = f"{r.title} {r.summary}"
            # Own feeds carry everything; keep only stories about the configured topics.
            if keyword is None and keywords and not _mentions(blob, keywords):
                continue
            if exclude and _mentions(blob, exclude):
                continue
            found.append(
                (
                    FlowItem(
                        title=r.title,
                        url=r.url,
                        summary=r.summary or None,
                        text=r.summary or "",
                        source_name=r.publisher,
                        published_at=r.published_at.isoformat() if r.published_at else None,
                        image_url=r.image_url,
                        data={"keyword": keyword} if keyword else {},
                    ),
                    keyword,
                )
            )
            kept += 1
        await ctx.log(f"{'Google News: ' + keyword if keyword else url}: {kept} stor{'y' if kept == 1 else 'ies'}")

    seen = {it.canonical_url for it in items if it.canonical_url}
    fresh: list[FlowItem] = []
    for it, _ in sorted(found, key=lambda p: parse_dt(p[0].published_at) or parse_dt("1970-01-01T00:00:00+00:00"), reverse=True):
        key = it.canonical_url or it.title.lower()
        if key in seen or not recent(it, hours):
            continue
        seen.add(key)
        fresh.append(it)
        if len(fresh) >= int(cfg["max_items"]):
            break

    if cfg.get("fetch_full_text", True):
        for it in fresh:
            await ctx.check_cancel()
            await read_article(ctx, it)
    await ctx.log(f"{len(fresh)} new stor{'y' if len(fresh) == 1 else 'ies'} after de-duplication and the {hours}h recency filter")
    return [*items, *fresh]
