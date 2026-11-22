"""image_finder: images for each item (or for listed pages / search terms) as MediaImage records.

Sources: the item's own page (og:image, main and gallery images above a minimum size, with alt text / captions),
and open-license search on Openverse and Wikimedia Commons (licence, licence URL and credit included).
Open licences (CC0, public domain, CC BY, CC BY-SA) rank first by default; unknown licences can be excluded.
Every candidate is fingerprinted with a perceptual dHash so near-duplicates (Hamming ≤ 6) are dropped. Alt text
can be written by a vision model (MODEL_VISION) or, without one, from the page's alt/caption/context."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.platform.flow import FlowItem
from app.platform.media import drop_near_duplicates, page_images, rank
from app.platform.tools import invoke
from app.services.fetcher import FetchError


class AltText(BaseModel):
    alt: str = Field(min_length=3, max_length=180)


async def _alt(ctx, img: dict[str, Any], context: str, image_bytes: bytes | None) -> str | None:
    vision = get_settings().model_vision
    prompt = ("Write alt text (max 125 characters) describing what the image shows, for a screen reader. "
              f"Context: {context[:400]}\nExisting alt/caption: {img.get('alt') or 'none'}")
    try:
        if vision and image_bytes:
            out = await ctx.generate(task="alt_text", system="You describe images precisely and briefly.", prompt=prompt, schema=AltText,
                                     context={"alt": img.get("alt"), "context": context}, temperature=0.1, max_tokens=120, model=vision,
                                     images=[image_bytes])
        else:
            out = await ctx.generate(task="alt_text", system="You write short, factual alt text from the caption and context only.",
                                     prompt=prompt + "\nDo not describe things you cannot know from the caption/context.", schema=AltText,
                                     context={"alt": img.get("alt"), "context": context}, temperature=0.1, max_tokens=120, model="fast")
        return out.alt.strip()
    except Exception as exc:  # alt text is optional; the image is still useful without it
        await ctx.log(f"Alt text not written for {img['url'][:80]}: {str(exc)[:120]}", "warn")
        return img.get("alt")


async def find_for(ctx, cfg: dict[str, Any], *, page_url: str | None, query: str | None, context: str) -> tuple[list[dict[str, Any]], dict[str, int]]:
    sources = cfg.get("sources") or ["page"]
    min_w, min_h = int(cfg.get("min_width", 400)), int(cfg.get("min_height", 0))
    found: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    if "page" in sources and page_url:
        try:
            res = await invoke(ctx, "web.fetch", summary=lambda r: {"status": r.status}, url=page_url)
            imgs = page_images(res.text, res.final_url or page_url, min_width=min_w, min_height=min_h)
            found += imgs
            counts["page"] = len(imgs)
        except FetchError as exc:
            await ctx.log(f"{page_url}: {exc}", "warn")
    for provider in ("openverse", "wikimedia"):
        if provider in sources and query:
            try:
                imgs = await invoke(ctx, "image.search", summary=lambda r: {"images": len(r)}, provider=provider, query=query,
                                    limit=int(cfg.get("max_images_per_item", 5)) * 2)
                found += imgs
                counts[provider] = len(imgs)
            except (FetchError, ValueError) as exc:
                await ctx.log(f"{provider} search for '{query}' failed: {exc}", "warn")
    found = [m for m in found if not ((m.get("width") and m["width"] < min_w) or (m.get("height") and m["height"] < min_h))]
    if cfg.get("exclude_unknown_license"):
        found = [m for m in found if m["license"]]
    found = rank(found, prefer_open=cfg.get("prefer_open_license", True))
    limit = int(cfg.get("max_images_per_item", 5))
    candidates, kept, dropped = found[: limit * 3], [], 0
    blobs: dict[str, bytes] = {}
    for m in candidates:
        try:
            h = await invoke(ctx, "image.hash", summary=lambda r: {"hash": r["hash"]}, url=m.get("thumb_url") or m["url"])
            m["hash"] = h["hash"]
            blobs[m["url"]] = h["bytes"]
        except (FetchError, ValueError):
            pass
        unique, d = drop_near_duplicates([*kept, m])
        dropped += d
        kept = unique
        if len(kept) >= limit:
            break
    counts["duplicates"] = dropped
    if cfg.get("alt_text"):
        for m in kept:
            m["alt"] = await _alt(ctx, m, context, blobs.get(m["url"]))
    return kept, counts


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    targets = list(items)
    if not targets:
        targets = [FlowItem(title=s["url"], url=s["url"]) for s in cfg.get("pages") or []]
        targets += [FlowItem(title=q, text=q) for q in cfg.get("queries") or []]
    if not targets:
        raise ValueError("Give the image finder pages, search terms, or items from an earlier step")
    with_images = 0
    for item in targets:
        await ctx.check_cancel()
        if item.data.get("images") and not cfg.get("replace_existing"):
            continue
        query = (cfg.get("queries") or [None])[0] if not items else None
        query = query or (item.title if item.title != item.url else None)
        images, counts = await find_for(ctx, cfg, page_url=item.url, query=query, context=f"{item.title}. {item.summary or item.text[:300]}")
        if images:
            item.data["images"] = images
            item.image_url = images[0]["url"]
            with_images += 1
        found = ", ".join(f"{k} {v}" for k, v in counts.items() if v)
        await ctx.log(f"'{item.title[:60]}': {len(images)} image(s)" + (f" ({found})" if found else ""))
    await ctx.log(f"Images for {with_images} of {len(targets)} item(s)" + (" · open licences ranked first" if cfg.get("prefer_open_license", True) else ""))
    return targets
