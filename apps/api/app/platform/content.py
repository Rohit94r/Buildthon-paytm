"""Content items: one piece of content with a variant per format (article, LinkedIn post, X thread…).
Pipeline steps keep a FlowItem and its ContentItem row in sync through `sync_content`."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_factory
from app.models import ContentItem
from app.platform.catalog import CONTENT_FORMATS
from app.platform.flow import FlowItem
from app.services.slug import slugify, unique_slug
from app.services.text import truncate_words

LONG_FORM = ("article", "blog_post", "newsletter")
# Preferred variant per connection kind when the connection does not choose one.
PRIMARY_ORDER = ("article", "blog_post", "newsletter", "linkedin_post", "facebook_post", "whatsapp_message", "x_thread",
                 "instagram_caption", "short_video_script")


def make_variant(fmt: str, body: str, title: str | None = None) -> dict[str, Any]:
    return {"format": fmt, "title": title, "body": body, "char_count": len(body or "")}


def variants_from_formats(formats: dict[str, str], title: str, titles: dict[str, str] | None = None) -> list[dict[str, Any]]:
    titles = titles or {}
    return [
        make_variant(fmt, body, titles.get(fmt) or (title if fmt in LONG_FORM else None))
        for fmt, body in sorted(formats.items(), key=lambda kv: list(CONTENT_FORMATS).index(kv[0]) if kv[0] in CONTENT_FORMATS else 99)
        if body
    ]


def variant_body(content: ContentItem, fmt: str) -> str | None:
    for v in content.variants or []:
        if v.get("format") == fmt:
            return v.get("body")
    return None


def primary_format(content: ContentItem, preferred: str | None = None) -> str | None:
    have = {v.get("format") for v in content.variants or []}
    if preferred and preferred in have:
        return preferred
    return next((f for f in PRIMARY_ORDER if f in have), None)


async def taken_slugs(db: AsyncSession, tenant_id: uuid.UUID, base: str) -> set[str]:
    rows = await db.execute(select(ContentItem.slug).where(ContentItem.tenant_id == tenant_id, ContentItem.slug.like(f"{base[:60]}%")))
    return set(rows.scalars())


async def sync_content(rctx, item: FlowItem, *, persona: str | None = None) -> None:
    """Save `item` as content through the tool registry (`content.save`). No-op in test (dry-run) mode."""
    if not rctx.persist:
        return
    from app.platform.tools import invoke

    await invoke(rctx, "content.save", summary=lambda cid: {"content_id": cid}, item=item, persona=persona)


async def save_content(rctx, item: FlowItem, *, persona: str | None = None) -> None:
    """Create or update the ContentItem behind `item` from its current state. No-op in test (dry-run) mode.
    New content starts as `draft` when the pipeline requires approval, else `approved`."""
    if not rctx.persist:
        return
    titles = item.data.get("variant_titles") if isinstance(item.data.get("variant_titles"), dict) else None
    variants = variants_from_formats(item.formats, item.title, titles)
    if not variants:
        body = item.text or item.summary or ""
        variants = [make_variant("article", body, item.title)] if body else []
    summary = item.summary or truncate_words(item.main_body(), 280, ellipsis=True)
    tags = item.data.get("tags") if isinstance(item.data.get("tags"), list) else None
    images = [i for i in item.data.get("images") or [] if isinstance(i, dict) and i.get("url")][:20]
    async with session_factory()() as db:
        row = await db.get(ContentItem, uuid.UUID(item.content_id)) if item.content_id else None
        if row is None:
            base = slugify(item.title)
            row = ContentItem(
                tenant_id=rctx.tenant.id,
                run_id=rctx.run_id,
                pipeline_id=rctx.pipeline_id,
                title=item.title[:500],
                slug=unique_slug(base, await taken_slugs(db, rctx.tenant.id, base)),
                summary=summary,
                source_url=item.url,
                source_name=item.source_name,
                persona=persona,
                status="draft" if rctx.require_approval else "approved",
                tags=[str(t) for t in tags or []][:12],
                image_url=item.image_url or (images[0]["url"] if images else None),
                images=images,
                variants=variants,
                publications=[],
                source_text=(item.text or "")[:50_000],
            )
            db.add(row)
            await db.flush()
            item.content_id = str(row.id)
            rctx.counters["content_created"] = rctx.counters.get("content_created", 0) + 1
        else:
            row.title = item.title[:500]
            row.summary = summary
            row.variants = variants
            if persona:
                row.persona = persona
            if tags is not None:
                row.tags = [str(t) for t in tags][:12]
            if images:
                row.images = images
            if (item.image_url or images) and not row.image_url:
                row.image_url = item.image_url or images[0]["url"]
        if isinstance(item.data.get("seo"), dict):
            row.seo = item.data["seo"]
            if item.data["seo"].get("slug") and item.data["seo"]["slug"] != row.slug:
                taken = await taken_slugs(db, rctx.tenant.id, item.data["seo"]["slug"])
                taken.discard(row.slug)
                row.slug = unique_slug(item.data["seo"]["slug"], taken)
        if isinstance(item.data.get("quality"), dict):
            row.quality = item.data["quality"]
        await db.commit()
