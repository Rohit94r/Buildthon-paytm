"""Mock outputs for the platform agent tasks (rewrite, multi_format, extract, chat_answer, custom_llm,
categorize, quality_rubric). Extractive and deterministic: every number in the output comes from the input
text, so grounding checks pass for the right reason, and every output validates against the schema the
platform agent sends."""

from __future__ import annotations

import re
from typing import Any

from app.services.text import truncate_words


def _sents(text: str) -> list[str]:
    from app.services.text import sentences

    return [s for s in sentences(re.sub(r"\s+", " ", text or "")) if len(s.split()) >= 4]


def _pad(text: str, n: int) -> str:
    return text if len(text) >= n else (text + " " + "." * n)[: max(n, len(text))]


def rewrite(c: dict[str, Any]) -> dict[str, Any]:
    from app.services.seo_rules import extract_keywords

    title = (c.get("title") or "Update").strip()
    sents = _sents(c.get("text") or "") or [f"{title} was reported today."]
    budget, body, n = int(c.get("target_words") or 300), [], 0
    for s in sents:
        if n >= budget:
            break
        body.append(s)
        n += len(s.split())
    paras = [" ".join(body[i : i + 3]) for i in range(0, len(body), 3)]
    md = paras[0] + ("\n\n## Key details\n\n" + "\n\n".join(paras[1:]) if len(paras) > 1 else "")
    return {
        "title": _pad(title, 5)[:200],
        "summary": _pad(truncate_words(sents[0], 380), 10),
        "body": _pad(md, 40),
        "tags": [k.replace(" ", "-") for k in extract_keywords(title, " ".join(sents), top=4)],
    }


def multi_format(c: dict[str, Any]) -> dict[str, Any]:
    from app.services.seo_rules import extract_keywords

    title = (c.get("title") or "Update").strip()
    sents = _sents(c.get("text") or "") or [f"{title} was reported today in detail."]
    lead = " ".join(sents[:2])
    tags = [k.replace(" ", "") for k in extract_keywords(title, " ".join(sents), top=int(c.get("hashtags") or 5))] or ["news"]
    long_body = "## Overview\n\n" + " ".join(sents[:3]) + ("\n\n## Details\n\n" + " ".join(sents[3:8]) if len(sents) > 3 else "")
    out: dict[str, Any] = {}
    for fmt in c.get("formats") or []:
        if fmt in ("article", "blog_post"):
            out[fmt] = _pad(long_body, 100)
        elif fmt == "linkedin_post":
            out[fmt] = _pad(truncate_words(f"{title}\n\n" + "\n\n".join(sents[:4]), 1200), 40)
        elif fmt == "x_thread":
            out[fmt] = [truncate_words(s, 260) for s in (title, *sents[:3])]
        elif fmt == "instagram_caption":
            out[fmt] = {"caption": _pad(truncate_words(f"{title}. {lead}", 1500), 10), "hashtags": tags}
        elif fmt == "facebook_post":
            out[fmt] = _pad(truncate_words(f"{title}. {lead}", 1400) + " What do you think?", 20)
        elif fmt == "newsletter":
            out[fmt] = {"subject": _pad(truncate_words(title, 80), 5), "body": _pad(" ".join(sents[:5]), 40)}
        elif fmt == "short_video_script":
            out[fmt] = {
                "hook": _pad(truncate_words(title, 120), 5),
                "scenes": [{"visual": f"On-screen text: {truncate_words(s, 60)}", "voiceover": s} for s in sents[:3]],
                "cta": "Follow for more updates",
            }
        elif fmt == "whatsapp_message":
            out[fmt] = _pad(truncate_words(f"{title}\n{sents[0]}", 560), 10)
    return out


def extract(c: dict[str, Any]) -> dict[str, Any]:
    """Reads `Label: value` lines, the way a model would read a simple detail page."""
    from app.platform.datasets import coerce_value

    text = c.get("text") or ""
    out: dict[str, Any] = {}
    for f in c.get("fields") or []:
        labels = {f["key"].replace("_", " "), str(f.get("label") or "")}
        raw = None
        for label in sorted((x for x in labels if x), key=len, reverse=True):
            m = re.search(rf"(?im)^\W*{re.escape(label)}\s*[:\-–]\s*(.+?)\s*$", text)
            if m:
                raw = m.group(1)
                break
        if raw is None and f["key"] in ("name", "title"):
            raw = c.get("title")
        if raw is None and f.get("type") == "url":
            raw = c.get("url")
        value = coerce_value(f.get("type", "text"), raw, f.get("unit"))
        if f.get("type") in ("number", "currency", "rating") and value is not None:
            value = float(value)
        out[f["key"]] = value
    return out


def chat_answer(c: dict[str, Any]) -> dict[str, Any]:
    records = c.get("records") or []
    table = c.get("table") or {}
    labels = {f["key"]: f.get("label", f["key"]) for f in table.get("fields") or []}
    if not records:
        return {"answer": "I could not find matching records.", "suggestions": []}
    lines = [f"From the {c.get('dataset', 'dataset')} records ({', '.join('**' + r['key'] + '**' for r in records)}):"]
    for key, winner in (table.get("winners") or {}).items():
        row = next((r for r in table.get("rows") or [] if r["key"] == winner), None)
        lines.append(f"- Best {labels.get(key, key).lower()}: **{winner}** ({row['values'].get(key) if row else 'n/a'})")
    if len(lines) == 1:
        lines.append("- " + "; ".join(r["key"] for r in records))
    sug = [f"Tell me more about {records[0]['key']}"]
    if len(records) > 1:
        sug.append(f"Which is cheaper: {records[0]['key']} or {records[1]['key']}?")
    return {"answer": "\n".join(lines), "suggestions": sug}


def custom_llm(c: dict[str, Any]) -> dict[str, Any]:
    text = c.get("text") or c.get("title") or ""
    out: dict[str, Any] = {}
    for f in c.get("fields") or []:
        t = f.get("type", "text")
        out[f["key"]] = (truncate_words(" ".join(_sents(text)[:2]) or text, 300) if t in ("text", "url", "date")
                         else [] if t == "list" else None)
    return out


def categorize(c: dict[str, Any]) -> dict[str, Any]:
    cats = c.get("categories") or ["Other"]
    text = (c.get("text") or "").lower()
    for cat in cats:
        if re.search(rf"(?<![a-z0-9]){re.escape(cat.lower())}(?![a-z0-9])", text):
            return {"category": cat}
    return {"category": cats[-1]}


def quality_rubric(c: dict[str, Any]) -> dict[str, Any]:
    flags = c.get("flags") or []
    return {"score": 2 if flags else 4, "issues": [f"Fix: {f}" for f in flags][:6]}


def fact_check(c: dict[str, Any]) -> dict[str, Any]:
    """Claims whose content words mostly appear in the source are 'verified'; the rest 'unsupported'."""
    from app.services.text import content_tokens

    src = set(content_tokens(c.get("source") or ""))
    out = []
    for i, claim in enumerate(c.get("claims") or [], 1):
        toks = set(content_tokens(claim))
        ok = not toks or len(toks & src) / len(toks) >= 0.6
        out.append({"index": i, "verdict": "verified" if ok else "unsupported", "note": "mock: word overlap with the source"})
    return {"claims": out}


def report_summary(c: dict[str, Any]) -> dict[str, Any]:
    items = c.get("items") or []
    titles = [str(i.get("title") or "") for i in items if i.get("title")]
    summary = f"{len(items)} item(s) in this report. " + ("Leading: " + "; ".join(titles[:3]) + "." if titles else "")
    return {"summary": _pad(summary, 20), "highlights": titles[:5]}


def extract_list(c: dict[str, Any]) -> dict[str, Any]:
    """Rows from `Label: value` lines; a new row starts each time the first field's label appears again."""
    from app.platform.datasets import coerce_value

    fields = c.get("fields") or []
    if not fields:
        return {"items": []}

    def label_re(f: dict[str, Any]) -> re.Pattern[str]:
        labels = sorted({f["key"].replace("_", " "), str(f.get("label") or "")} - {""}, key=len, reverse=True)
        return re.compile(r"(?i)^\W*(?:" + "|".join(re.escape(x) for x in labels) + r")\s*[:\-–]\s*(.+?)\s*$")

    patterns = [(f, label_re(f)) for f in fields]
    rows: list[dict[str, Any]] = []
    for line in (c.get("text") or "").splitlines():
        for f, pat in patterns:
            m = pat.match(line)
            if not m:
                continue
            if f is fields[0] or not rows:
                rows.append({})
            value = coerce_value(f.get("type", "text"), m.group(1), f.get("unit"))
            rows[-1][f["key"]] = float(value) if f.get("type") in ("number", "currency", "rating") and value is not None else value
            break
    return {"items": [{f["key"]: r.get(f["key"]) for f in fields} for r in rows]}


def alt_text(c: dict[str, Any]) -> dict[str, Any]:
    base = (c.get("alt") or "").strip() or f"Image related to {(c.get('context') or 'the item').split('.')[0][:100]}"
    return {"alt": _pad(base[:170], 3)}


PLATFORM_TASKS = {
    "extract_list": extract_list,
    "alt_text": alt_text,
    "fact_check": fact_check,
    "report_summary": report_summary,
    "rewrite": rewrite,
    "multi_format": multi_format,
    "extract": extract,
    "chat_answer": chat_answer,
    "custom_llm": custom_llm,
    "categorize": categorize,
    "quality_rubric": quality_rubric,
}
