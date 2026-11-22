"""Minimal, safe Markdown -> HTML for public content (`body_html`). Everything is HTML-escaped first, then a
small subset is rendered: headings, paragraphs, lists, blockquotes, bold/italic, inline code, http(s) links.
No raw HTML passes through, so model output can never inject markup into a client's site."""

from __future__ import annotations

import html
import re

_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")
_BOLD = re.compile(r"\*\*(.+?)\*\*|__(.+?)__")
_ITALIC = re.compile(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])|(?<![_\w])_(?!\s)(.+?)(?<!\s)_(?![_\w])")
_CODE = re.compile(r"`([^`]+)`")


def _inline(text: str) -> str:
    out = html.escape(text, quote=True)
    codes: list[str] = []

    def keep_code(m: re.Match[str]) -> str:
        codes.append(f"<code>{m.group(1)}</code>")
        return f"\x00{len(codes) - 1}\x00"

    out = _CODE.sub(keep_code, out)
    out = _LINK.sub(lambda m: f'<a href="{m.group(2)}" rel="noopener nofollow">{m.group(1)}</a>', out)
    out = _BOLD.sub(lambda m: f"<strong>{m.group(1) or m.group(2)}</strong>", out)
    out = _ITALIC.sub(lambda m: f"<em>{m.group(1) or m.group(2)}</em>", out)
    return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m.group(1))], out)


def to_html(markdown: str) -> str:
    lines = (markdown or "").replace("\r\n", "\n").split("\n")
    blocks: list[str] = []
    para: list[str] = []
    list_tag: str | None = None
    items: list[str] = []
    quote: list[str] = []

    def flush() -> None:
        nonlocal para, list_tag, items, quote
        if para:
            blocks.append(f"<p>{_inline(' '.join(para))}</p>")
            para = []
        if list_tag:
            blocks.append(f"<{list_tag}>" + "".join(f"<li>{_inline(i)}</li>" for i in items) + f"</{list_tag}>")
            list_tag, items = None, []
        if quote:
            blocks.append(f"<blockquote><p>{_inline(' '.join(quote))}</p></blockquote>")
            quote = []

    for raw in lines:
        line = raw.strip()
        if not line:
            flush()
            continue
        if m := re.match(r"^(#{1,6})\s+(.*)$", line):
            flush()
            level = len(m.group(1))
            blocks.append(f"<h{level}>{_inline(m.group(2).strip())}</h{level}>")
            continue
        if re.match(r"^(-{3,}|\*{3,})$", line):
            flush()
            blocks.append("<hr>")
            continue
        if m := re.match(r"^[-*+]\s+(.*)$", line):
            if list_tag != "ul":
                flush()
                list_tag = "ul"
            items.append(m.group(1))
            continue
        if m := re.match(r"^\d+[.)]\s+(.*)$", line):
            if list_tag != "ol":
                flush()
                list_tag = "ol"
            items.append(m.group(1))
            continue
        if line.startswith(">"):
            if para or list_tag:
                flush()
            quote.append(line.lstrip("> ").strip())
            continue
        if list_tag or quote:
            flush()
        para.append(line)
    flush()
    return "\n".join(blocks)
