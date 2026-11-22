"""Agent catalogue: platform-owned, ready-to-activate agents, loaded from config/catalog/agents.json (the single
source of truth, shared with the dashboard demo). Each entry is an engine (agent kind) plus a `preset` that makes
it useful out of the box, its tools, integrations and pricing tier. Activating one creates a normal agent in the
workspace (source "platform") that the customer then configures."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.platform.catalog import AGENT_KINDS
from app.platform.tools import KIND_TOOLS, TOOLS


@dataclass(frozen=True)
class CatalogEntry:
    key: str
    name: str
    tagline: str
    description: str
    everyday_use: str
    category: str
    kind: str
    icon: str
    capabilities: list[str]
    tools: list[str]
    integrations: list[str]
    required_config: list[str]
    example_workflows: list[str]
    pricing: dict[str, Any]
    availability: str
    version: str
    docs: str
    preset: dict[str, Any] = field(default_factory=dict)

    @property
    def tier(self) -> str:
        return self.pricing.get("tier", "free")

    @property
    def config(self) -> dict[str, Any]:
        return dict((self.preset or {}).get("config") or {})

    @property
    def model(self) -> str | None:
        return (self.preset or {}).get("model")

    @property
    def tool_keys(self) -> list[str]:
        """Tools the activated agent may use: the engine's own tools plus any extra listed for this entry."""
        return list(dict.fromkeys([*KIND_TOOLS.get(self.kind, []), *(t for t in self.tools if t in TOOLS)]))

    def out(self, *, entitled: bool, activated: list[str]) -> dict[str, Any]:
        return {
            "key": self.key, "name": self.name, "tagline": self.tagline, "description": self.description, "everyday_use": self.everyday_use,
            "category": self.category, "kind": self.kind, "kind_category": AGENT_KINDS[self.kind].category, "icon": self.icon,
            "capabilities": self.capabilities, "tools": self.tools, "integrations": self.integrations, "required_config": self.required_config,
            "example_workflows": self.example_workflows, "pricing": self.pricing, "availability": self.availability, "version": self.version,
            "docs": self.docs, "entitled": entitled, "activated_agent_ids": activated,
        }


def catalog_path() -> Path:
    return get_settings().config_dir / "catalog" / "agents.json"


@lru_cache
def _load(path: str) -> dict[str, CatalogEntry]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    names = CatalogEntry.__dataclass_fields__
    entries = {}
    for raw in data["agents"]:
        entry = CatalogEntry(**{k: v for k, v in raw.items() if k in names})
        if entry.kind not in AGENT_KINDS:
            raise ValueError(f"Catalogue entry {entry.key}: unknown engine '{entry.kind}'")
        entries[entry.key] = entry
    return entries


def catalog() -> dict[str, CatalogEntry]:
    return _load(str(catalog_path()))


def entitled(entry: CatalogEntry, plan_limits: dict[str, Any], plan_key: str) -> bool:
    """free: every plan · pro: plans with premium agents · enterprise: business and enterprise plans."""
    if entry.tier == "free":
        return True
    if entry.tier == "enterprise":
        return plan_key in ("business", "enterprise")
    return bool(plan_limits.get("premium_agents"))
