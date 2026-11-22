"""Keep the agent catalogue in one place.

config/catalog/agents.json is the single source of truth. This script:
  1. copies it to apps/web/lib/demo/catalog-agents.json (the dashboard's demo mode reads that copy), and
  2. regenerates docs/product/agents.md (the plain-language guide to every agent).

    python scripts/sync_catalog.py          # write both
    python scripts/sync_catalog.py --check  # exit 1 if either is out of date (CI)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "config" / "catalog" / "agents.json"
DEMO = ROOT / "apps" / "web" / "lib" / "demo" / "catalog-agents.json"
DOC = ROOT / "docs" / "product" / "agents.md"

CATEGORY_TITLES = {
    "collect": "Collect data",
    "images": "Images",
    "research": "Research & news",
    "content": "Write & create",
    "seo": "SEO",
    "data": "Clean, compare & save data",
    "sales": "Sales & leads",
    "publishing": "Publish",
    "operations": "Operations & alerts",
    "support": "Customer support",
    "assist": "Website assistants",
}
TIER = {"free": "Free", "pro": "Pro", "enterprise": "Enterprise"}


def anchor(doc_path: str) -> str:
    return doc_path.split("#", 1)[1] if "#" in doc_path else ""


def render_doc(data: dict) -> str:
    agents = data["agents"]
    out = [
        "# Agent guide",
        "",
        f"Every agent in the LayerFlow catalogue ({len(agents)} agents, catalogue v{data.get('version', '?')}), in plain language.",
        "Activate one from **Agents → Catalogue**, fill in the highlighted fields, press **Test**, then use it alone or chain it with others in a workflow.",
        "",
        "> Generated from `config/catalog/agents.json` by `scripts/sync_catalog.py`. Edit the JSON, not this file.",
        "",
        "**Chaining tip:** most useful setups follow *collect → clean/sort → write/compare → save/publish/alert*. Any agent can follow any other.",
        "",
    ]
    by_cat: dict[str, list[dict]] = {}
    for a in agents:
        by_cat.setdefault(a["category"], []).append(a)
    out.append("| Category | Agents |")
    out.append("| --- | --- |")
    for cat, items in by_cat.items():
        links = " · ".join(f"[{a['name']}](#{anchor(a['docs'])})" for a in items)
        out.append(f"| {CATEGORY_TITLES.get(cat, cat)} | {links} |")
    out.append("")
    for cat, items in by_cat.items():
        out.append(f"## {CATEGORY_TITLES.get(cat, cat)}")
        out.append("")
        for a in items:
            out.append(f'<a id="{anchor(a["docs"])}"></a>')
            out.append(f"### {a['name']}")
            out.append("")
            badge = TIER.get(a["pricing"]["tier"], a["pricing"]["tier"])
            beta = " · beta" if a.get("availability") == "beta" else ""
            out.append(f"**{a['everyday_use']}** ({badge}{beta})")
            out.append("")
            out.append(a["description"])
            out.append("")
            out.append(f"- **Can do:** {', '.join(a['capabilities'])}")
            if a.get("required_config"):
                out.append(f"- **You fill in:** {', '.join(f'`{c}`' for c in a['required_config'])}")
            if a.get("integrations"):
                out.append(f"- **Works with:** {', '.join(a['integrations'])}")
            if a.get("example_workflows"):
                out.append(f"- **Try:** {a['example_workflows'][0]}")
            if a["pricing"].get("note"):
                out.append(f"- **Note:** {a['pricing']['note']}")
            out.append(f"- Engine: `{a['kind']}`")
            out.append("")
    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    check = "--check" in sys.argv
    raw = SRC.read_text(encoding="utf-8")
    data = json.loads(raw)
    keys = [a["key"] for a in data["agents"]]
    if len(keys) != len(set(keys)):
        print("duplicate agent keys in agents.json", file=sys.stderr)
        return 1
    demo_text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    doc_text = render_doc(data)
    stale = []
    for path, text in ((DEMO, demo_text), (DOC, doc_text)):
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current != text:
            stale.append(path)
            if not check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
    if check and stale:
        print("out of date: " + ", ".join(str(p.relative_to(ROOT)) for p in stale) + " (run python scripts/sync_catalog.py)", file=sys.stderr)
        return 1
    print(f"{len(keys)} agents · " + ("up to date" if not stale else "wrote " + ", ".join(str(p.relative_to(ROOT)) for p in stale)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
