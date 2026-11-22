"""HTML understanding shared by the scraping engines: link collection with include/exclude patterns, pagination
discovery, HTML tables -> rows, and published structured data (JSON-LD incl. @graph, Open Graph, microdata).
Pure functions over an lxml tree, so they are easy to test and never touch the network."""

from __future__ import annotations

import fnmatch
import json
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from app.platform.datasets import _num
from app.services.canonical import canonicalize
from app.services.text import normalize_space

STRUCTURED_TYPES = ("Product", "Event", "JobPosting", "Article", "NewsArticle", "BlogPosting", "Review", "Organization",
                    "LocalBusiness", "Course", "EducationalOrganization", "CollegeOrUniversity", "Recipe", "Offer", "Hackathon")
NEXT_TEXT = re.compile(r"^\s*(next|next page|older posts|more|›|»|>|→|next\s*[›»>→])\s*$", re.I)
REGEX_HINT = re.compile(r"[\^$()|\\+{}]")
_NUMERIC_CELL = re.compile(r"^[\s₹$€£]*[-+]?\d[\d,]*(\.\d+)?\s*(%|lpa|lakh|lac|cr|crore|k)?\s*$", re.I)


# ---------------------------------------------------------------- links
def url_matches(url: str, pattern: str) -> bool:
    """Glob (`/product/*`, `*.pdf`), regex (`re:^https://x/\\d+$` or anything with regex syntax) or plain substring."""
    p = pattern.strip()
    if not p:
        return True
    if p.startswith("re:") or REGEX_HINT.search(p):
        try:
            return re.search(p[3:] if p.startswith("re:") else p, url) is not None
        except re.error:
            return p in url
    if any(ch in p for ch in "*?["):
        path = urlsplit(url).path or "/"
        return fnmatch.fnmatch(url, p) or fnmatch.fnmatch(path, p) or fnmatch.fnmatch(url, f"*{p}*")
    return p in url


def keep_url(url: str, include: list[str], exclude: list[str]) -> bool:
    if include and not any(url_matches(url, p) for p in include):
        return False
    return not any(url_matches(url, p) for p in exclude)


def page_links(tree: Any, base: str, *, same_site: bool = True) -> list[tuple[str, str]]:
    """(canonical absolute URL, anchor text) for every http(s) link on the page, in page order, de-duplicated."""
    host = (urlsplit(base).hostname or "").removeprefix("www.")
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for a in tree.xpath("//a[@href]"):
        href = (a.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absolute = urljoin(base, href).split("#")[0]
        if urlsplit(absolute).scheme not in ("http", "https"):
            continue
        if same_site and (urlsplit(absolute).hostname or "").removeprefix("www.") != host:
            continue
        canon = canonicalize(absolute)
        if canon in seen:
            continue
        seen.add(canon)
        out.append((canon, normalize_space(a.text_content())[:200]))
    return out


def next_page(tree: Any, current: str) -> str | None:
    """rel=next, a "Next"/"›" link, or the ?page=N+1 pattern when the page links to it."""
    for xp in ("//link[@rel='next']/@href", "//a[@rel='next']/@href"):
        found = tree.xpath(xp)
        if found:
            return urljoin(current, found[0])
    for a in tree.xpath("//a[@href]"):
        label = normalize_space(a.text_content()) or (a.get("aria-label") or "")
        if NEXT_TEXT.match(label) or (a.get("aria-label") or "").lower() in ("next", "next page"):
            href = urljoin(current, a.get("href"))
            if href.split("#")[0] != current:
                return href
    parts = urlsplit(current)
    query = dict(parse_qsl(parts.query))
    key = next((k for k in ("page", "p", "pg", "paged") if k in query and query[k].isdigit()), None)
    n = int(query[key]) if key else 1
    key = key or "page"
    candidate = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode({**query, key: str(n + 1)}), ""))
    links = {urljoin(current, h).split("#")[0] for h in tree.xpath("//a/@href")}
    if candidate in links or any(canonicalize(x) == canonicalize(candidate) for x in links):
        return candidate
    return None


# ---------------------------------------------------------------- tables
def clean_cell(text: str) -> Any:
    """Numbers and money become numbers ("₹ 1,20,000" -> 120000, "12.5%" -> 12.5); everything else stays text."""
    t = normalize_space(text)
    if t and _NUMERIC_CELL.match(t):
        v = _num(t, None)
        if v is not None:
            return v
    return t or None


def _key(label: str, i: int) -> str:
    k = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    return k if k and k[0].isalpha() else f"col_{i + 1}"


def parse_tables(tree: Any, min_rows: int = 1) -> list[dict[str, Any]]:
    """Every <table> -> {headers, rows: [dict]}. Header = <thead>/<th> row, else a first row of non-numeric text."""
    tables = []
    for t_index, table in enumerate(tree.xpath("//table")):
        rows = [r for r in table.xpath(".//tr") if r.xpath("./td|./th")]
        if not rows:
            continue
        cells = [[normalize_space(c.text_content()) for c in r.xpath("./td|./th")] for r in rows]
        has_th = bool(rows[0].xpath("./th")) or bool(table.xpath("./thead"))
        first_texty = all(c and not _NUMERIC_CELL.match(c) for c in cells[0])
        if has_th or (len(cells) > 1 and first_texty and len(set(cells[0])) == len(cells[0])):
            labels, body = cells[0], cells[1:]
        else:
            labels, body = [f"Column {i + 1}" for i in range(max(len(r) for r in cells))], cells
        keys, seen = [], set()
        for i, label in enumerate(labels):
            k = _key(label, i)
            while k in seen:
                k += "_2"
            seen.add(k)
            keys.append(k)
        out_rows = []
        for r in body:
            if not any(r):
                continue
            row = {keys[i] if i < len(keys) else f"col_{i + 1}": clean_cell(v) for i, v in enumerate(r)}
            out_rows.append(row)
        if len(out_rows) >= min_rows:
            caption = table.xpath("./caption")
            tables.append({"index": t_index, "caption": normalize_space(caption[0].text_content()) if caption else None,
                           "headers": dict(zip(keys, labels, strict=False)), "rows": out_rows})
    return tables


# ---------------------------------------------------------------- structured data
def _type_names(node: dict[str, Any]) -> list[str]:
    t = node.get("@type")
    types = t if isinstance(t, list) else [t]
    return [str(x).split("/")[-1] for x in types if x]


def _walk_jsonld(node: Any, out: list[dict[str, Any]], depth: int = 0) -> None:
    if depth > 6:
        return
    if isinstance(node, list):
        for n in node:
            _walk_jsonld(n, out, depth + 1)
    elif isinstance(node, dict):
        if "@graph" in node:
            _walk_jsonld(node["@graph"], out, depth + 1)
        types = _type_names(node)
        if any(t in STRUCTURED_TYPES for t in types):
            out.append(node)
        if node.get("@type") == "ItemList":
            for el in node.get("itemListElement") or []:
                _walk_jsonld(el.get("item", el) if isinstance(el, dict) else el, out, depth + 1)


def jsonld_entities(tree: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for script in tree.xpath("//script[@type='application/ld+json']"):
        raw = (script.text or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            try:
                data = json.loads(re.sub(r",\s*([}\]])", r"\1", raw))  # trailing commas are common in the wild
            except ValueError:
                continue
        _walk_jsonld(data, out)
    return out


def microdata_entities(tree: Any) -> list[dict[str, Any]]:
    out = []
    for scope in tree.xpath("//*[@itemscope][@itemtype]"):
        if scope.xpath("ancestor::*[@itemscope]"):
            continue
        t = (scope.get("itemtype") or "").rstrip("/").split("/")[-1]
        if t not in STRUCTURED_TYPES:
            continue
        ent: dict[str, Any] = {"@type": t}
        for prop in scope.xpath(".//*[@itemprop]"):
            name = prop.get("itemprop")
            value = prop.get("content") or prop.get("href") or prop.get("src") or prop.get("datetime") or normalize_space(prop.text_content())
            if name and value and name not in ent:
                ent[name] = value
        out.append(ent)
    return out


def opengraph(tree: Any) -> dict[str, str]:
    og = {}
    for m in tree.xpath("//meta[@property or @name]"):
        key = (m.get("property") or m.get("name") or "").lower()
        if key.startswith(("og:", "product:", "article:")) and m.get("content"):
            og.setdefault(key, m.get("content"))
    return og


def structured_entities(tree: Any) -> tuple[list[dict[str, Any]], str | None]:
    """Entities of the supported schema.org types and where they came from (json-ld / microdata / opengraph)."""
    ents = jsonld_entities(tree)
    if ents:
        return ents, "JSON-LD"
    ents = microdata_entities(tree)
    if ents:
        return ents, "microdata"
    og = opengraph(tree)
    if og.get("og:title"):
        ent = {"@type": {"product": "Product", "article": "Article"}.get(og.get("og:type", "").split(".")[0], "WebPage"),
               "name": og.get("og:title"), "description": og.get("og:description"), "image": og.get("og:image"), "url": og.get("og:url")}
        if og.get("product:price:amount"):
            ent["offers"] = {"price": og["product:price:amount"], "priceCurrency": og.get("product:price:currency")}
        return [ent], "Open Graph"
    return [], None


def flatten(node: Any, prefix: str = "", out: dict[str, Any] | None = None, depth: int = 0) -> dict[str, Any]:
    """{"offers": {"price": 5}} -> {"offers.price": 5}; lists of objects use their first element."""
    out = {} if out is None else out
    if depth > 5:
        return out
    if isinstance(node, dict):
        for k, v in node.items():
            if k.startswith("@") and k != "@type":
                continue
            flatten(v, f"{prefix}.{k}" if prefix else k, out, depth + 1)
    elif isinstance(node, list):
        if node and all(isinstance(x, str | int | float) for x in node):
            out[prefix] = list(node)
        elif node:
            flatten(node[0], prefix, out, depth + 1)
    elif node is not None and prefix:
        out[prefix] = node
    return out


ALIASES = {
    "title": ("name", "headline"), "name": ("name", "headline", "title"), "price": ("offers.price", "price", "offers.lowPrice"),
    "mrp": ("offers.highPrice",), "currency": ("offers.priceCurrency",), "rating": ("aggregateRating.ratingValue", "reviewRating.ratingValue"),
    "reviews": ("aggregateRating.reviewCount",), "brand": ("brand.name", "brand"), "image": ("image", "image.url"), "url": ("url", "offers.url"),
    "in_stock": ("offers.availability",), "start_date": ("startDate",), "end_date": ("endDate",), "date": ("datePublished", "startDate"),
    "location": ("location.name", "location.address.addressLocality", "jobLocation.address.addressLocality", "address.addressLocality"),
    "city": ("address.addressLocality", "location.address.addressLocality", "jobLocation.address.addressLocality"),
    "organizer": ("organizer.name", "hiringOrganization.name"), "company": ("hiringOrganization.name",),
    "salary": ("baseSalary.value.value", "baseSalary.value.minValue"), "author": ("author.name", "author"),
    "description": ("description",), "email": ("email",), "phone": ("telephone",), "mode": ("eventAttendanceMode",),
}


def map_entity(entity: dict[str, Any], fields: list[dict[str, Any]]) -> dict[str, Any]:
    """Fill the requested fields from a structured entity by key, alias and camelCase similarity."""
    flat = flatten(entity)
    low = {k.lower().replace("_", ""): v for k, v in flat.items()}
    out: dict[str, Any] = {}
    for f in fields:
        key = f["key"]
        cands = [*ALIASES.get(key, ()), key, re.sub(r"_([a-z])", lambda m: m.group(1).upper(), key)]
        for c in cands:
            v = flat.get(c, low.get(c.lower().replace("_", "")))
            if v not in (None, "", []):
                if key == "in_stock" and isinstance(v, str):
                    v = "InStock" in v
                if key == "mode" and isinstance(v, str):
                    v = {"OnlineEventAttendanceMode": "online", "OfflineEventAttendanceMode": "offline",
                         "MixedEventAttendanceMode": "hybrid"}.get(v.split("/")[-1], v)
                out[key] = v
                break
    return out


def page_meta(tree: Any) -> dict[str, Any]:
    def first(xp: str) -> str | None:
        found = tree.xpath(xp)
        return normalize_space(found[0] if isinstance(found[0], str) else found[0].text_content()) if found else None

    return {
        "meta_description": first("//meta[@name='description']/@content"),
        "canonical": first("//link[@rel='canonical']/@href"),
        "headings": [normalize_space(h.text_content()) for h in tree.xpath("//h1|//h2|//h3")][:20],
        "lang": first("//html/@lang"),
    }
