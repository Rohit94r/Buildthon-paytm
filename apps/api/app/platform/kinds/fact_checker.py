"""fact_checker: verify the claims in each item's generated text against its source text. Deterministic first
(numbers must appear in the source; word overlap), then an optional model verdict per claim. Results go to
item.data.fact_check; unsupported/contradicted claims flag (or drop) the item."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.platform.flow import FlowItem
from app.services.sanitize import wrap_source
from app.services.text import content_tokens, numbers_in, sentences

VERDICTS = ("verified", "unsupported", "contradicted")


class ClaimVerdict(BaseModel):
    index: int = Field(ge=1)
    verdict: Literal["verified", "unsupported", "contradicted"]
    note: str = ""


class Verdicts(BaseModel):
    claims: list[ClaimVerdict] = Field(default_factory=list)


def claims_of(text: str, limit: int) -> list[str]:
    """Checkable sentences: ones carrying a number or several capitalised names."""
    out = []
    for s in sentences(text.replace("#", " ")):
        caps = sum(1 for w in s.split()[1:] if w[:1].isupper())
        if numbers_in(s) or caps >= 2:
            out.append(s.strip())
        if len(out) >= limit:
            break
    return out


def deterministic(claim: str, source: str, src_tokens: set[str]) -> str:
    if numbers_in(claim) - numbers_in(source):
        return "unsupported"
    toks = set(content_tokens(claim))
    overlap = len(toks & src_tokens) / len(toks) if toks else 1.0
    return "verified" if overlap >= 0.6 else "unsupported"


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    kept: list[FlowItem] = []
    for item in items:
        await ctx.check_cancel()
        text = "\n".join(item.formats.values()) if item.formats else (item.summary or "")
        source = f"{item.data.get('source_title', '')}\n{item.text}"
        claims = claims_of(text, int(cfg.get("max_claims", 8)))
        src_tokens = set(content_tokens(source))
        results = [{"claim": c, "verdict": deterministic(c, source, src_tokens), "note": "deterministic check"} for c in claims]
        if cfg.get("use_model", True) and claims:
            listing = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(claims))
            out = await ctx.generate(
                task="fact_check", schema=Verdicts, temperature=0.0, max_tokens=900,
                system="You verify claims strictly against the source. 'verified' only when the source states it.",
                prompt=f"For each claim decide verified / unsupported / contradicted using only the SOURCE.\n\nCLAIMS\n{listing}\n\nSOURCE\n"
                + wrap_source(1, item.url or "", item.source_name or "", source, cap=8000),
                context={"claims": claims, "source": source},
            )
            for v in out.claims:
                if 1 <= v.index <= len(results):
                    r = results[v.index - 1]
                    # Deterministic number failures stand: a model cannot talk its way past a missing number.
                    if not (r["verdict"] == "unsupported" and numbers_in(r["claim"]) - numbers_in(source)):
                        r["verdict"], r["note"] = v.verdict, v.note or "model verdict"
        summary = {v: sum(1 for r in results if r["verdict"] == v) for v in VERDICTS}
        item.data["fact_check"] = {**summary, "claims": results}
        bad = summary["unsupported"] + summary["contradicted"]
        if bad:
            item.flags.append("unsupported_claims")
            await ctx.log(f"'{item.title[:60]}': {summary['verified']} verified, {summary['unsupported']} unsupported, {summary['contradicted']} contradicted", "warn")
            if cfg.get("on_fail") == "drop":
                continue
        kept.append(item)
    await ctx.log(f"Fact check: {len(kept)} of {len(items)} item(s) kept")
    return kept
