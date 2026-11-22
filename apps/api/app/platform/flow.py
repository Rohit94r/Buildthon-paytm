"""FlowItem: the unit of data passed between pipeline steps (mirrors `FlowItem` in platform-types.ts)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from app.services.canonical import canonicalize


@dataclass
class FlowItem:
    title: str
    text: str = ""
    url: str | None = None
    summary: str | None = None
    source_name: str | None = None
    published_at: str | None = None
    image_url: str | None = None
    data: dict[str, Any] = field(default_factory=dict)
    formats: dict[str, str] = field(default_factory=dict)
    flags: list[str] = field(default_factory=list)
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    # Internal: the ContentItem row this item became (not part of the public FlowItem shape).
    content_id: str | None = None

    @property
    def canonical_url(self) -> str | None:
        return canonicalize(self.url) if self.url else None

    def out(self) -> dict[str, Any]:
        """Contract shape (API responses)."""
        return {
            "id": self.id,
            "title": self.title,
            "url": self.url,
            "text": self.text,
            "summary": self.summary,
            "source_name": self.source_name,
            "published_at": self.published_at,
            "image_url": self.image_url,
            "data": self.data,
            "formats": self.formats,
            "flags": self.flags,
        }

    def state(self) -> dict[str, Any]:
        """Persisted shape (run state between steps), including internal links."""
        return {**self.out(), "content_id": self.content_id}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> FlowItem:
        return cls(
            id=str(d.get("id") or uuid.uuid4().hex),
            title=str(d.get("title") or "").strip() or "Untitled",
            text=str(d.get("text") or ""),
            url=d.get("url") or None,
            summary=d.get("summary") or None,
            source_name=d.get("source_name") or None,
            published_at=d.get("published_at") or None,
            image_url=d.get("image_url") or None,
            data=dict(d.get("data") or {}),
            formats={k: str(v) for k, v in (d.get("formats") or {}).items() if v},
            flags=[str(f) for f in d.get("flags") or []],
            content_id=d.get("content_id") or None,
        )

    def main_body(self) -> str:
        """The best long-form text of the item: a written article if one exists, else the source text."""
        for fmt in ("article", "blog_post", "newsletter"):
            if self.formats.get(fmt):
                return self.formats[fmt]
        return self.text or self.summary or ""


def items_from_input(payload: dict[str, Any] | None) -> list[FlowItem]:
    """Turn a run/test input (`{text?, url?, items?}`) into starting items."""
    payload = payload or {}
    items = [FlowItem.from_dict(i) for i in payload.get("items") or [] if isinstance(i, dict)]
    if payload.get("text") or payload.get("url"):
        text = str(payload.get("text") or "")
        title = str(payload.get("title") or "").strip() or (text.strip().split("\n")[0][:120] if text.strip() else payload.get("url") or "Input")
        items.append(FlowItem(title=title, text=text, url=payload.get("url") or None, data=dict(payload.get("data") or {})))
    return items
