"""quality_gate: deterministic checks first (they cannot be talked around), optional model rubric second.
Checks: numbers in generated text must appear in the source, banned phrases, body length, duplicate of recent
content (title similarity or heavy text overlap). Failing items are flagged or dropped (content -> rejected)."""

from __future__ import annotations

import re
import uuid
from datetime import timedelta
from difflib import SequenceMatcher
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.db import session_factory, utcnow
from app.models import ContentItem
from app.platform.content import sync_content
from app.platform.flow import FlowItem
from app.services import banned as banned_mod
from app.services.sanitize import wrap_source
from app.services.text import containment, numbers_in, shingles, word_count

_URL = re.compile(r"https?://\S+")
PENALTY = {"ungrounded_numbers": 30, "banned_phrases": 20, "too_short": 20, "too_long": 10, "duplicate": 40, "low_rubric_score": 25}


class Rubric(BaseModel):
    score: int = Field(ge=1, le=5)
    issues: list[str] = Field(default_factory=list, max_length=6)


def _norm_title(t: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in t).split())


async def _recent_content(ctx, exclude: set[str]) -> list[tuple[str, str]]:
    since = utcnow() - timedelta(days=30)
    async with session_factory()() as db:
        rows = await db.execute(
            select(ContentItem.id, ContentItem.title, ContentItem.variants)
            .where(ContentItem.tenant_id == ctx.tenant.id, ContentItem.created_at >= since, ContentItem.status != "rejected")
            .order_by(ContentItem.created_at.desc())
            .limit(300)
        )
        out = []
        for cid, title, variants in rows.all():
            if str(cid) in exclude:
                continue
            body = next((v.get("body", "") for v in variants or [] if v.get("format") in ("article", "blog_post", "newsletter")), "")
            out.append((title, body))
        return out


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    phrases = banned_mod.banned_phrases(cfg.get("extra_banned") or [])
    own_ids = {i.content_id for i in items if i.content_id}
    recent = await _recent_content(ctx, own_ids) if cfg.get("check_duplicates", True) else []
    seen_titles: list[str] = []
    kept: list[FlowItem] = []
    failed = dropped = 0

    for item in items:
        await ctx.check_cancel()
        flags: list[str] = []
        notes: list[str] = []
        generated = "\n".join(item.formats.values())
        body = item.main_body()
        n_words = word_count(body)
        if n_words < int(cfg.get("min_words", 0)):
            flags.append("too_short")
            notes.append(f"{n_words} words (< {cfg['min_words']})")
        if n_words > int(cfg.get("max_words", 10**6)):
            flags.append("too_long")
            notes.append(f"{n_words} words (> {cfg['max_words']})")
        if cfg.get("check_banned", True):
            hits = banned_mod.scan(f"{item.title}\n{generated or body}", phrases)
            if hits:
                flags.append("banned_phrases")
                notes.append("banned: " + ", ".join(h["phrase"] for h in hits[:5]))
        if cfg.get("check_numbers", True) and generated:
            source = f"{item.data.get('source_title', '')} {item.text} {item.summary or ''}"
            bad = sorted(numbers_in(f"{item.title}\n{generated}") - numbers_in(source))
            if bad:
                flags.append("ungrounded_numbers")
                notes.append("numbers not in source: " + ", ".join(bad[:6]))
        if cfg.get("check_duplicates", True):
            nt = _norm_title(item.title)
            mine = shingles(body)
            dup = any(SequenceMatcher(None, nt, _norm_title(t)).ratio() >= 0.9 for t in seen_titles) or any(
                SequenceMatcher(None, nt, _norm_title(t)).ratio() >= 0.9 or (len(mine) > 20 and containment(mine, shingles(b)) >= 0.6)
                for t, b in recent
            )
            if dup:
                flags.append("duplicate")
                notes.append("duplicates recent content")
            seen_titles.append(item.title)
        rubric_score: int | None = None
        if cfg.get("use_model_rubric") and body:
            rubric = await ctx.generate(
                task="quality_rubric",
                system="You are a strict editor. Score the draft 1-5 for accuracy against the source, clarity and voice.",
                prompt="Score the DRAFT against the SOURCE (1 = unusable, 5 = publish as is). List concrete issues.\n\n"
                + wrap_source(1, item.url or "", "source", item.text or item.summary or "", cap=5000)
                + "\n\nDRAFT\n" + body[:6000],
                schema=Rubric,
                context={"flags": flags, "text": body},
                temperature=0.0,
                max_tokens=400,
            )
            rubric_score = rubric.score
            if rubric.score < int(cfg.get("min_rubric_score", 3)):
                flags.append("low_rubric_score")
                notes.append(f"rubric {rubric.score}/5: " + "; ".join(rubric.issues[:3]))

        score = max(0, 100 - sum(PENALTY.get(f, 10) for f in flags))
        if rubric_score is not None:
            score = min(score, rubric_score * 20)
        item.data["quality"] = {"score": score, "flags": flags}
        if not flags:
            await sync_content(ctx, item)
            kept.append(item)
            continue
        failed += 1
        await ctx.log(f"'{item.title[:70]}' failed: " + "; ".join(notes), "warn")
        if cfg.get("on_fail") == "drop":
            dropped += 1
            await _reject(ctx, item, "; ".join(notes))
            continue
        item.flags.extend(f for f in flags if f not in item.flags)
        await sync_content(ctx, item)
        kept.append(item)

    await ctx.log(f"Quality gate: {len(items) - failed} passed, {failed} failed" + (f", {dropped} dropped" if dropped else ""))
    return kept


async def _reject(ctx, item: FlowItem, reason: str) -> None:
    if not ctx.persist:
        return
    if not item.content_id:
        await sync_content(ctx, item)
    async with session_factory()() as db:
        row = await db.get(ContentItem, uuid.UUID(item.content_id))
        if row is not None:
            row.status = "rejected"
            row.reject_reason = f"Quality gate: {reason}"[:1000]
            row.quality = item.data.get("quality")
            await db.commit()
