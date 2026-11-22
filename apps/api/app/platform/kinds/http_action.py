"""http_action: call an allowlisted REST API connection (CRM, Google Sheets via Apps Script, an internal API)
with a JSON body templated from each item. Requests may only reach the connection's base host (plus its extra
allowed hosts) and pass the SSRF guard. The response can be stored on the item."""

from __future__ import annotations

import json
import re
from typing import Any

from app.platform.flow import FlowItem
from app.platform.kinds.custom_llm import render_template
from app.platform.kinds.data_transform import get_field
from app.platform.tools import invoke

_WHOLE = re.compile(r"^\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}$")


def _value(item: FlowItem, path: str) -> Any:
    if path in ("formats", "data"):
        return getattr(item, path)
    if path.startswith("formats."):
        return item.formats.get(path[8:])
    return get_field(item, path)


def render_body(template: Any, item: FlowItem) -> Any:
    """Walk the parsed JSON template: a string that is exactly "{{path}}" becomes the raw value (numbers, lists stay
    typed); placeholders inside longer strings are substituted as text."""
    if isinstance(template, dict):
        return {k: render_body(v, item) for k, v in template.items()}
    if isinstance(template, list):
        return [render_body(v, item) for v in template]
    if isinstance(template, str):
        m = _WHOLE.match(template.strip())
        if m:
            return _value(item, m.group(1))
        return render_template(template, item) if "{{" in template else template
    return template


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    conn_ids = cfg.get("connections") or []
    if not conn_ids:
        raise ValueError("Pick a REST API connection")
    template = json.loads(cfg.get("body_template") or "{}")
    method, path = cfg.get("method", "POST"), cfg.get("path") or ""
    store = (cfg.get("response_field") or "").strip()
    targets = items if cfg.get("per_item", True) else [FlowItem(title="batch", data={"items": [i.out() for i in items]})]
    ok = 0
    for item in targets:
        await ctx.check_cancel()
        body = render_body(template, item) if cfg.get("per_item", True) else {"items": [render_body(template, i) for i in items]}
        res = await invoke(ctx, "http.request", summary=lambda r: {"status": r.get("status")}, connection_id=conn_ids[0],
                           method=method, path=render_template(path, item) if "{{" in path else path, body=body)
        ok += 1
        if store and cfg.get("per_item", True):
            item.data[store] = res.get("body")
    await ctx.log(f"{method} {path or '/'}: {ok} request(s) sent" + (" (dry run)" if not ctx.persist else ""))
    return items
