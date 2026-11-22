"""seo_optimizer: deterministic SEO metadata using the newsroom's SEO rules (title 30–60 chars, meta 140–158,
clean 3–8 word slug, keyword extraction) plus Article JSON-LD. No model: these are rules, not opinions."""

from __future__ import annotations

from typing import Any

from app.core.db import utcnow
from app.platform.content import sync_content
from app.platform.flow import FlowItem
from app.services.seo_rules import (
    META_MIN,
    TITLE_MIN,
    extract_keywords,
    fit_meta,
    fit_title,
    validate_meta,
    validate_title_tag,
)
from app.services.slug import slugify, validate_slug
from app.services.text import normalize_space, sentences


def _plain(markdown: str) -> str:
    import re

    text = re.sub(r"[#*_`>]+", " ", markdown or "")
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return normalize_space(text)


def build_meta(summary: str, body: str) -> str:
    text = _plain(summary)
    if len(text) < META_MIN:
        for s in sentences(_plain(body)):
            if s in text:
                continue
            text = f"{text} {s}".strip()
            if len(text) >= META_MIN:
                break
    return fit_meta(text)


def build_title(title: str, keywords: list[str]) -> str:
    t = fit_title(_plain(title))
    if len(t) < TITLE_MIN and keywords and keywords[0].lower() not in t.lower():
        t = fit_title(f"{t}: {keywords[0].title()}")
    return t


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    site = (cfg.get("site_url") or (f"https://{ctx.workspace_domain}" if ctx.workspace_domain else "")).rstrip("/")
    prefix = "/" + (cfg.get("path_prefix") or "").strip("/") if (cfg.get("path_prefix") or "").strip("/") else ""
    brand = cfg.get("brand_name") or ctx.workspace_name or ctx.tenant.name
    preferred = [k.lower() for k in cfg.get("primary_keywords") or []]
    top = int(cfg.get("max_keywords", 6))
    warnings = 0

    async def optimise(item: FlowItem) -> FlowItem:
        nonlocal warnings
        body = _plain(item.main_body())
        blob = f"{item.title} {body}".lower()
        keywords = [k for k in preferred if k in blob]
        for k in extract_keywords(item.title, body, top=top * 2):
            if k not in keywords and not any(k in p or p in k for p in keywords):
                keywords.append(k)
        keywords = keywords[:top]
        title_tag = build_title(item.title, keywords)
        meta = build_meta(item.summary or "", body)
        slug = slugify(item.title)
        url = f"{site}{prefix}/{slug}" if site else None
        json_ld: dict[str, Any] = {
            "@context": "https://schema.org",
            "@type": cfg.get("schema_type", "Article"),
            "headline": item.title[:110],
            "description": meta,
            "keywords": ", ".join(keywords),
            "datePublished": item.published_at or utcnow().isoformat(),
            "author": {"@type": "Organization", "name": brand},
            "publisher": {"@type": "Organization", "name": brand},
        }
        if url:
            json_ld["mainEntityOfPage"] = {"@type": "WebPage", "@id": url}
            json_ld["url"] = url
        if item.image_url:
            json_ld["image"] = [item.image_url]
        issues = validate_title_tag(title_tag, brand=brand) + validate_meta(meta) + validate_slug(slug)
        if issues:
            warnings += 1
            await ctx.log(f"'{item.title[:60]}': " + "; ".join(issues[:3]), "warn")
        item.data["seo"] = {"title_tag": title_tag, "meta_description": meta, "slug": slug, "keywords": keywords,
                            "json_ld": json_ld, "canonical_url": url, "issues": issues}
        await sync_content(ctx, item)
        return item

    out = await ctx.for_each(items, optimise, label="SEO")
    await ctx.log(f"SEO metadata for {len(out)} item(s)" + (f"; {warnings} with warnings" if warnings else ""))
    return out
