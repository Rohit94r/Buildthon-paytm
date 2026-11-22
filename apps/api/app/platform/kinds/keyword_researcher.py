"""keyword_researcher: expand seed keywords into what people actually type, from free autosuggest (Google, Bing as
fallback) with a–z and question prefixes, plus terms competitors use (TF-IDF over their pages), then group by
search intent with transparent rules. Output: one item per keyword and a markdown report."""

from __future__ import annotations

import math
import re
import string
from collections import Counter
from typing import Any

from app.platform.extract import page_text
from app.platform.flow import FlowItem
from app.platform.kinds.common import fetch
from app.platform.tools import invoke
from app.services.text import STOPWORDS, words

QUESTION_PREFIXES = ("how", "what", "why", "best", "which", "is", "can", "vs")
INTENT_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("transactional", re.compile(r"\b(buy|price|prices|cost|cheap|discount|deal|deals|coupon|order|book|booking|hire|apply|admission|"
                                 r"enrol|enroll|subscribe|download|quote|near me|for sale|fees?)\b", re.I)),
    ("commercial", re.compile(r"\b(best|top|vs|versus|review|reviews|compare|comparison|alternatives?|ranking|rankings|rated|cheapest)\b", re.I)),
    ("navigational", re.compile(r"\b(login|log in|sign in|official|website|contact|customer care|phone number|address|app|portal|careers)\b", re.I)),
    ("informational", re.compile(r"\b(how|what|why|when|where|who|guide|tips|meaning|ideas|examples|definition|is|can|does|tutorial|learn)\b", re.I)),
]
INTENT_LABEL = {"informational": "Informational (learn)", "commercial": "Commercial (compare before buying)",
                "transactional": "Transactional (ready to act)", "navigational": "Navigational (looking for a site)"}


def intent_of(keyword: str) -> tuple[str, str]:
    """(intent, reason). Rules are checked in order; plain topic phrases default to informational."""
    for intent, pattern in INTENT_RULES:
        m = pattern.search(keyword)
        if m:
            return intent, f"contains '{m.group(0).lower()}'"
    return "informational", "no buying or brand signal"


def tfidf_terms(docs: list[str], top: int = 30) -> list[tuple[str, float]]:
    """Distinctive 1–2 word terms across competitor pages: term frequency × inverse document frequency."""
    tokenised = []
    for d in docs:
        toks = [w.lower() for w in words(d) if len(w) > 2 and w.lower() not in STOPWORDS and not w.isdigit()]
        grams = toks + [f"{a} {b}" for a, b in zip(toks, toks[1:], strict=False)]
        tokenised.append(Counter(grams))
    n = len(tokenised)
    df: Counter[str] = Counter()
    for c in tokenised:
        df.update(set(c))
    scores: Counter[str] = Counter()
    for c in tokenised:
        total = sum(c.values()) or 1
        for term, tf in c.items():
            if tf < 2:
                continue
            scores[term] += (tf / total) * (math.log((1 + n) / (1 + df[term])) + 1)
    return scores.most_common(top)


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    seeds = [s.strip() for s in (cfg.get("seed_keywords") or []) if s.strip()] or [it.title for it in items][:5]
    if not seeds:
        raise ValueError("Add at least one seed keyword")
    lang, region, cap = cfg.get("language", "en"), cfg.get("region", "IN"), int(cfg.get("max_keywords", 100))
    found: dict[str, dict[str, Any]] = {}
    requests = failed = 0

    def add(kw: str, source: str, seed: str) -> None:
        k = re.sub(r"\s+", " ", kw.strip().lower())
        if k and k not in found and len(found) < cap:
            found[k] = {"source": source, "seed": seed}

    for seed in seeds:
        add(seed, "seed", seed)
        queries = [seed]
        if cfg.get("question_prefixes", True):
            queries += [f"{p} {seed}" for p in QUESTION_PREFIXES]
        if cfg.get("expand_alphabet", True):
            queries += [f"{seed} {c}" for c in string.ascii_lowercase]
        for q in queries[: int(cfg.get("max_requests_per_seed", 36))]:
            if len(found) >= cap:
                break
            await ctx.check_cancel()
            requests += 1
            suggestions = await invoke(ctx, "suggest.keywords", summary=lambda r: {"suggestions": len(r)}, query=q, language=lang, region=region)
            if not suggestions:
                failed += 1
            for s in suggestions:
                add(s, "suggest", seed)
        await ctx.log(f"'{seed}': {sum(1 for v in found.values() if v['seed'] == seed)} keyword(s) from {len(queries)} suggestion request(s)")
    if requests and failed == requests:
        await ctx.log("Search suggestions were unavailable (blocked or offline); only seeds and competitor terms are used", "warn")

    competitor_docs = []
    for url in cfg.get("competitor_urls") or []:
        res = await fetch(ctx, url)
        if res is not None:
            competitor_docs.append(page_text(res.text))
    if competitor_docs:
        terms = tfidf_terms(competitor_docs, top=int(cfg.get("competitor_terms", 25)))
        for term, _ in terms:
            add(term, "competitor", "competitors")
        await ctx.log(f"Competitor pages: {len(terms)} distinctive term(s) from {len(competitor_docs)} page(s)")

    out = []
    groups: dict[str, list[str]] = {k: [] for k in INTENT_LABEL}
    for kw, meta in found.items():
        intent, reason = intent_of(kw)
        groups[intent].append(kw)
        out.append(FlowItem(title=kw, text=kw, data={"keyword": kw, "intent": intent, "intent_reason": reason, "source": meta["source"],
                                                     "seed": meta["seed"], "words": len(kw.split()), "question": kw.split()[0] in QUESTION_PREFIXES}))
    lines = [f"# Keyword research: {', '.join(seeds)}", "", f"{len(found)} keyword(s) · free search suggestions"
             + (" + competitor pages" if competitor_docs else ""), ""]
    for intent, kws in groups.items():
        if kws:
            lines += [f"## {INTENT_LABEL[intent]} ({len(kws)})", ""] + [f"- {k}" for k in kws[:60]] + [""]
    ctx.outputs["report"] = "\n".join(lines).strip()
    await ctx.log("Intent: " + ", ".join(f"{k} {len(v)}" for k, v in groups.items() if v))
    return out
