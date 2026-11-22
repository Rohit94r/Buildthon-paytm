"""custom_llm: the user's own prompt template with {{title}}, {{text}}, {{summary}}, {{url}} and {{data.x}}
placeholders; the model fills the user's output fields, which are written into item.data."""

from __future__ import annotations

import json
import re
from typing import Any

from app.platform.extract import extraction_schema
from app.platform.flow import FlowItem

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}")
TEXT_CAP = 8000


def render_template(template: str, item: FlowItem) -> str:
    def value(path: str) -> str:
        if path == "title":
            return item.title
        if path == "text":
            return (item.main_body() or "")[:TEXT_CAP]
        if path == "summary":
            return item.summary or ""
        if path == "url":
            return item.url or ""
        if path.startswith("data."):
            cur: Any = item.data
            for part in path[5:].split("."):
                cur = cur.get(part) if isinstance(cur, dict) else None
            if cur is None:
                return ""
            return cur if isinstance(cur, str) else json.dumps(cur, ensure_ascii=False)
        if path.startswith("formats."):
            return item.formats.get(path[8:], "")
        return ""

    return _PLACEHOLDER.sub(lambda m: value(m.group(1)), template)


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    fields = cfg["output_fields"]
    schema = extraction_schema(fields, name="CustomOutput")
    spec = "\n".join(f"- {f['key']} ({f.get('type', 'text')}): {f.get('description') or f.get('label')}" for f in fields)

    async def apply(item: FlowItem) -> FlowItem:
        prompt = render_template(cfg["prompt"], item) + f"\n\nReturn these fields:\n{spec}"
        out = await ctx.generate(
            task="custom_llm",
            system=cfg.get("system") or "You are a precise assistant.",
            prompt=prompt,
            schema=schema,
            context={"fields": fields, "title": item.title, "text": item.main_body(), "prompt": prompt},
            temperature=float(cfg.get("temperature", 0.3)),
            max_tokens=1500,
        )
        raw = out.model_dump(by_alias=True)
        item.data.update({f["key"]: raw.get(f["key"]) for f in fields})
        return item

    out = await ctx.for_each(items, apply, label="Custom step")
    await ctx.log(f"Filled {', '.join(f['key'] for f in fields)} for {len(out)} item(s)")
    return out
