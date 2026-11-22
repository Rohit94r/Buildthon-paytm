"""Images as MediaImage records: page images (main, og:image, gallery) with alt text, open-license search results
(Openverse, Wikimedia Commons) with licence + credit, licence classification and a perceptual dHash for
near-duplicate detection. Parsing only; network access happens in the tools."""

from __future__ import annotations

import html as html_lib
import io
import re
from typing import Any
from urllib.parse import quote_plus, urljoin

from app.platform.extract import parse_html
from app.services.images import _allowed, candidates_from_html
from app.services.text import normalize_space

OPEN_LICENSES = re.compile(r"^(cc0|pdm|public domain|cc[- ]?by(?:[- ]sa)?)(?:[- ]?\d(?:\.\d)?)?$", re.I)
HAMMING_DUPLICATE = 6


def media(url: str, *, source: str, page_url: str | None = None, thumb_url: str | None = None, license: str | None = None,
          license_url: str | None = None, credit: str | None = None, width: int | None = None, height: int | None = None,
          alt: str | None = None) -> dict[str, Any]:
    lic = normalize_license(license)
    return {"url": url, "thumb_url": thumb_url, "page_url": page_url, "source": source, "license": lic, "license_url": license_url,
            "open_license": is_open(lic), "credit": credit, "width": width, "height": height, "hash": None, "alt": alt}


def normalize_license(raw: str | None, version: str | None = None) -> str | None:
    if not raw:
        return None
    t = normalize_space(re.sub(r"<[^>]+>", " ", str(raw)))
    low = t.lower().replace("_", "-")
    if low in ("cc0", "cc-zero", "cc0 1.0"):
        return "CC0"
    if low in ("pdm", "public domain", "pd", "public-domain") or low.startswith("public domain"):
        return "Public domain"
    m = re.match(r"^(?:cc[- ]?)?(by(?:-nc)?(?:-nd|-sa)?)(?:[- ]?(\d(?:\.\d)?))?$", low)
    if m:
        ver = m.group(2) or version
        return f"CC {m.group(1).upper()}" + (f" {ver}" if ver else "")
    return t


def is_open(license: str | None) -> bool:
    """Open for reuse with attribution: CC0, public domain, CC BY, CC BY-SA (not NC / ND)."""
    if not license:
        return False
    low = license.lower()
    if "nc" in low.split() or "-nc" in low or "nd" in low.split() or "-nd" in low:
        return False
    return low.startswith(("cc0", "public domain", "cc by"))


def page_images(markup: str, page_url: str, *, min_width: int = 0, min_height: int = 0, limit: int = 20) -> list[dict[str, Any]]:
    """The page's declared images (og:image / JSON-LD) then content images with alt text or captions. Tiny icons,
    logos and tracking pixels are skipped; images without declared dimensions are kept (sizes are often only in CSS)."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for c in candidates_from_html(markup, page_url):
        if c.url not in seen and _allowed(c.url):
            seen.add(c.url)
            out.append(media(c.url, source="og" if c.source in ("og", "jsonld") else "page", page_url=page_url, width=c.width, height=c.height))
    tree = parse_html(markup)
    for img in tree.xpath("//main//img|//article//img|//figure//img|//body//img"):
        src = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
        if not src or src.startswith("data:"):
            continue
        url = urljoin(page_url, src)
        if url in seen or not _allowed(url):
            continue
        w, h = _int(img.get("width")), _int(img.get("height"))
        if (w and w < min_width) or (h and h < min_height):
            continue
        seen.add(url)
        caption = img.xpath("ancestor::figure[1]//figcaption")
        alt = normalize_space(img.get("alt") or "") or (normalize_space(caption[0].text_content()) if caption else None)
        out.append(media(url, source="page", page_url=page_url, width=w, height=h, alt=alt or None))
        if len(out) >= limit:
            break
    return out


def _int(v: Any) -> int | None:
    try:
        return int(str(v).strip().removesuffix("px"))
    except (TypeError, ValueError):
        return None


def openverse_url(query: str, limit: int = 10) -> str:
    return f"https://api.openverse.org/v1/images/?q={quote_plus(query)}&license_type=commercial&page_size={limit}"


def parse_openverse(data: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for r in data.get("results") or []:
        if not r.get("url"):
            continue
        lic = normalize_license(r.get("license"), r.get("license_version"))
        creator = r.get("creator")
        out.append(media(r["url"], source="openverse", page_url=r.get("foreign_landing_url"), thumb_url=r.get("thumbnail"), license=lic,
                         license_url=r.get("license_url"), credit=(f"{creator} / {r.get('provider') or r.get('source') or 'Openverse'}" if creator else None),
                         width=_int(r.get("width")), height=_int(r.get("height")), alt=r.get("title")))
    return out


def wikimedia_url(query: str, limit: int = 10) -> str:
    return ("https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6"
            f"&gsrlimit={limit}&gsrsearch={quote_plus(query)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=640")


def parse_wikimedia(data: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    pages = ((data.get("query") or {}).get("pages") or {}).values()
    for p in sorted(pages, key=lambda x: x.get("index", 0)):
        info = (p.get("imageinfo") or [{}])[0]
        if not info.get("url") or not re.search(r"\.(jpe?g|png|webp)$", info["url"], re.I):
            continue
        meta = info.get("extmetadata") or {}

        def mv(key: str, meta: dict[str, Any] = meta) -> str | None:
            v = (meta.get(key) or {}).get("value")
            return normalize_space(html_lib.unescape(re.sub(r"<[^>]+>", " ", v))) if v else None

        out.append(media(info["url"], source="wikimedia", page_url=info.get("descriptionurl"), thumb_url=info.get("thumburl"),
                         license=mv("LicenseShortName"), license_url=mv("LicenseUrl"), credit=mv("Artist"),
                         width=_int(info.get("width")), height=_int(info.get("height")),
                         alt=mv("ImageDescription") or re.sub(r"^File:|\.\w+$", "", p.get("title") or "")))
    return out


def dhash(data: bytes, size: int = 8) -> str | None:
    """64-bit difference hash as 16 hex chars: robust to resizing / recompression, so near-equal pictures match."""
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - Pillow is a dependency
        return None
    try:
        with Image.open(io.BytesIO(data)) as img:
            gray = img.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
            px = list(gray.getdata())
    except Exception:  # unreadable or unsupported image
        return None
    bits = 0
    for row in range(size):
        for col in range(size):
            left, right = px[row * (size + 1) + col], px[row * (size + 1) + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:016x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def rank(images: list[dict[str, Any]], *, prefer_open: bool) -> list[dict[str, Any]]:
    def score(m: dict[str, Any]) -> tuple:
        area = (m.get("width") or 0) * (m.get("height") or 0)
        return (0 if (m["open_license"] or not prefer_open) else 1, 0 if m["source"] == "og" else 1, -area)

    return sorted(images, key=score)


def drop_near_duplicates(images: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    kept: list[dict[str, Any]] = []
    dropped = 0
    for m in images:
        if m.get("hash") and any(k.get("hash") and hamming(k["hash"], m["hash"]) <= HAMMING_DUPLICATE for k in kept):
            dropped += 1
            continue
        kept.append(m)
    return kept, dropped
