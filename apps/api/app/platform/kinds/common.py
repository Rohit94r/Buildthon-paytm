"""Helpers shared by collector kinds: fetching with readable errors, recency filter, article enrichment."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.platform.flow import FlowItem
from app.services.fetcher import FetchError, FetchResult
from app.services.text import word_count


async def fetch(rctx, url: str, *, robots: bool = True) -> FetchResult | None:
    """Fetch through the `web.fetch` tool (shared polite fetcher); failures are logged and skipped, never fatal."""
    from app.platform.tools import invoke

    try:
        return await invoke(rctx, "web.fetch", summary=lambda r: {"status": r.status, "bytes": r.size}, url=url, robots=robots)
    except FetchError as exc:
        await rctx.log(f"Could not fetch {url}: {exc}", "warn")
        return None


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def recent(item: FlowItem, max_age_hours: float) -> bool:
    """Undated items are kept: many pages carry no machine-readable date."""
    if not max_age_hours:
        return True
    dt = parse_dt(item.published_at)
    return dt is None or dt >= datetime.now(UTC) - timedelta(hours=max_age_hours)


async def read_article(rctx, item: FlowItem) -> None:
    """Fill the item's text (and missing title/image/date) from its page."""
    if not item.url:
        return
    res = await fetch(rctx, item.url)
    if res is None:
        return
    from app.platform.tools import invoke

    ex = await invoke(rctx, "html.extract", summary=lambda e: {"words": e.word_count}, html=res.text, url=res.final_url or item.url)
    if ex.paywalled:
        await rctx.log(f"Paywalled, kept the summary only: {item.url}", "warn")
        return
    if ex.injection_flags:
        item.flags.append("prompt_injection_stripped")
    if word_count(ex.text) >= max(40, word_count(item.text)):
        item.text = ex.text
    if not item.title or item.title == item.url:
        item.title = ex.title or item.title
    item.image_url = item.image_url or ex.og_image
    if not item.published_at and ex.published_at:
        item.published_at = ex.published_at.isoformat()
    item.source_name = item.source_name or ex.sitename
