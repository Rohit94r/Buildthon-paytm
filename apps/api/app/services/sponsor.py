"""First-class clients for the two sponsor APIs used by LiveDesk.

SerpApi  -> structured, real-time search results (web / news / jobs / shopping / maps / scholar) and the Extract API.
You.com  -> real-time web results and cited answers (Web Search API + Answer API).

Design rules (kept deliberately close to ``app/services/search.py``):

* The API key is read from settings, never from a request, and is sent in a header or a query parameter.
* Every call is short-lived, cached in-process for a few minutes (judges re-run the same demo a lot, and credits
  are finite), and degrades to clearly-labelled demo results when no key is configured or the network is down.
* ``set_transport()`` lets the test suite swap in an ``httpx.MockTransport`` without touching production code.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

log = logging.getLogger(__name__)

# ---------------------------------------------------------------- test seam
_transport: httpx.AsyncBaseTransport | None = None


def set_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    """Inject an httpx transport (tests use httpx.MockTransport). None restores real network access."""
    global _transport
    _transport = transport


# ---------------------------------------------------------------- tiny TTL cache
_CACHE: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str) -> Any | None:
    hit = _CACHE.get(key)
    if hit is not None and hit[0] > time.monotonic():
        return hit[1]
    return None


def _is_degraded(value: Any) -> bool:
    """True for sample/failure responses. These must never be cached as live data."""
    if isinstance(value, CitedAnswer):
        return value.degraded or value.provider == "demo"
    if isinstance(value, list):
        return not value or all(isinstance(h, SearchHit) and h.provider == "demo" for h in value)
    if isinstance(value, dict):
        return bool(value.get("degraded")) or value.get("provider") == "demo"
    return False


def _cache_put(key: str, value: Any, ttl_s: float) -> None:
    # A transient failure must not make a judge re-run show "sample data" for five minutes.
    if _is_degraded(value):
        return
    now = time.monotonic()
    _CACHE[key] = (now + max(0.0, ttl_s), value)
    # Bound memory: drop expired entries when the cache grows.
    if len(_CACHE) > 500:
        for k in [k for k, (exp, _) in _CACHE.items() if exp <= now][:250]:
            _CACHE.pop(k, None)


def clear_cache() -> None:
    _CACHE.clear()


# ---------------------------------------------------------------- value types
@dataclass
class SearchHit:
    title: str
    url: str
    summary: str = ""
    source: str = ""
    published_at: str | None = None
    position: int = 0
    provider: str = "serpapi"
    engine: str = ""
    query: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def out(self) -> dict[str, Any]:
        return {
            "title": self.title, "url": self.url, "summary": self.summary,
            "source": self.source, "published_at": self.published_at,
            "position": self.position, "provider": self.provider,
            "engine": self.engine, "query": self.query, "extra": self.extra,
        }


@dataclass
class CitedAnswer:
    answer: str
    citations: list[dict[str, Any]] = field(default_factory=list)
    results: list[SearchHit] = field(default_factory=list)
    provider: str = "you.com"
    degraded: bool = False

    def out(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "citations": self.citations,
            "results": [r.out() for r in self.results],
            "provider": self.provider,
            "degraded": self.degraded,
        }


# ---------------------------------------------------------------- keys / settings
def _first_key(*values: str) -> str:
    """First non-blank key, so a whitespace-only value cannot shadow a working alias."""
    for value in values:
        cleaned = (value or "").strip()
        if cleaned:
            return cleaned
    return ""


def serpapi_key() -> str:
    settings = get_settings()
    return _first_key(settings.serpapi_api_key, settings.serpapi_key_alias)


def youcom_key() -> str:
    settings = get_settings()
    return _first_key(settings.youcom_api_key, settings.ydc_api_key, os.environ.get("YDC_API_KEY", ""))


# ---------------------------------------------------------------- demo fallback
def demo_hits(query: str, *, provider: str, engine: str = "google", count: int = 4) -> list[SearchHit]:
    """Deterministic, clearly-labelled sample results used when a sponsor key is absent or a call fails.

    Demo results are never presented as live data: ``provider='demo'`` and the UI shows a 'sample data' badge.
    """
    topics = [t for t in query.replace("?", "").split() if len(t) > 3][:3] or ["live", "research"]
    subject = " ".join(topics)
    return [
        SearchHit(
            title=f"{subject.title()} — live web overview",
            url="https://example.org/research/overview",
            summary=f"Sample result for '{query}'. Add SERPAPI_API_KEY to fetch real-time results.",
            source="example.org", position=i + 1, provider="demo", engine=engine, query=query,
        )
        for i in range(max(1, min(count, 30)))
    ]


def demo_answer(query: str) -> CitedAnswer:
    hits = demo_hits(query, provider="demo", engine="you.answer", count=3)
    citations = [
        {"number": i + 1, "source": h.url, "title": h.title, "excerpt": h.summary}
        for i, h in enumerate(hits)
    ]
    return CitedAnswer(
        answer=f"Sample answer for '{query}'. [1][2] Add YOUCOM_API_KEY to get a real cited answer.",
        citations=citations, results=hits, provider="demo", degraded=True,
    )


# ---------------------------------------------------------------- SerpApi
_SERP_ENGINES: dict[str, tuple[str, str]] = {
    "google": ("google", "organic_results"),
    "google_news": ("google_news", "news_results"),
    "google_jobs": ("google_jobs", "jobs_results"),
    "google_shopping": ("google_shopping", "shopping_results"),
    "google_maps": ("google_maps", "local_results"),
    "google_scholar": ("google_scholar", "organic_results"),
}

# Single source of truth for the UI labels (the router and the agent catalogue use these).
ENGINE_LABELS = {
    "google": "Web",
    "google_news": "News",
    "google_jobs": "Jobs",
    "google_shopping": "Shopping",
    "google_maps": "Maps",
    "google_scholar": "Scholar",
}


def _first(item: dict[str, Any], *keys: str, default: str = "") -> str:
    for key in keys:
        val = item.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, (int, float)) and key in ("position",):
            return str(val)
    return default


def _normalise_serp(item: dict[str, Any], *, engine: str, query: str, position: int) -> SearchHit:
    if engine == "google_jobs":
        title = _first(item, "title", default="Job opening")
        url = _first(item, "apply_link", "link", "job_url", "related_link", default="")
        summary = " · ".join(x for x in [_first(item, "company_name"), _first(item, "location"), _first(item, "via")] if x)
        source = _first(item, "company_name", "via")
        published = _first(item, "posted_at") or None
    elif engine == "google_shopping":
        title = _first(item, "title", default="Product")
        url = _first(item, "link", default="")
        summary = " · ".join(x for x in [_first(item, "price"), _first(item, "source")] if x)
        source = _first(item, "source")
        published = None
    elif engine == "google_maps":
        title = _first(item, "title", "name", default="Place")
        url = _first(item, "link", "place_id_search", default="")
        summary = " · ".join(x for x in [_first(item, "address"), _first(item, "type"), _first(item, "rating")] if x)
        source = _first(item, "type", "address")
        published = None
    else:
        title = _first(item, "title", "name", default="Result")
        url = _first(item, "link", "url", default="")
        summary = _first(item, "snippet", "description", "summary", "description_text")
        source = _first(item, "source", "publisher", "displayed_link")
        published = _first(item, "date", "published_at") or None
    if not url:
        url = _first(item, "serpapi_link", "link", default="https://serpapi.com/")
    return SearchHit(
        title=title, url=url, summary=summary, source=source, published_at=published,
        position=int(item.get("position") or position), provider="serpapi", engine=engine, query=query,
        extra={k: v for k, v in item.items() if k in ("price", "extracted_price", "rating", "reviews", "address",
                                                     "company_name", "location", "thumbnail", "favicon")},
    )


async def serpapi_search(
    query: str,
    *,
    engine: str = "google",
    location: str = "",
    gl: str = "in",
    hl: str = "en",
    count: int = 10,
) -> list[SearchHit]:
    """Search through SerpApi and return normalised hits. Falls back to sample data when unavailable."""
    engine = engine if engine in _SERP_ENGINES else "google"
    count = max(1, min(int(count), 30))
    key = serpapi_key()
    settings = get_settings()
    cache_key = f"serpapi:{engine}:{query}:{location}:{gl}:{hl}:{count}"
    if not key:
        log.info("SerpApi key not configured; returning sample results for %r", query)
        return demo_hits(query, provider="serpapi", engine=engine, count=count)

    async def call() -> list[SearchHit]:
        params: dict[str, Any] = {
            "engine": _SERP_ENGINES[engine][0], "q": query, "api_key": key,
            "hl": hl, "gl": gl, "num": count, "output": "json",
        }
        if location:
            params["location"] = location
        url = f"{settings.serpapi_base_url.rstrip('/')}/search.json?{urlencode(params)}"
        try:
            async with httpx.AsyncClient(transport=_transport, timeout=settings.sponsor_timeout_s) as client:
                resp = await client.get(url, headers={"Accept": "application/json"})
            if resp.status_code >= 400:
                log.info("SerpApi returned HTTP %s (search request suppressed)", resp.status_code)
                return demo_hits(query, provider="serpapi", engine=engine, count=count)
            data = resp.json()
            if isinstance(data, dict) and data.get("error"):
                log.info("SerpApi reported an error (search request suppressed): %s", str(data.get("error"))[:120])
                return demo_hits(query, provider="serpapi", engine=engine, count=count)
            bucket = data.get(_SERP_ENGINES[engine][1], []) if isinstance(data, dict) else []
            if isinstance(bucket, dict):
                bucket = bucket.get("places") or bucket.get("results") or []
            hits = [
                _normalise_serp(item, engine=engine, query=query, position=i + 1)
                for i, item in enumerate(bucket[:count]) if isinstance(item, dict)
            ]
            if not hits:
                return demo_hits(query, provider="serpapi", engine=engine, count=count)
            # Do not persist the key inside the URL cache entry.
            return hits
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            # Never log the exception here: its request URL contains api_key=<secret>.
            log.info("SerpApi call failed (%s); using labelled sample data", type(exc).__name__)
            return demo_hits(query, provider="serpapi", engine=engine, count=count)

    # The cache key intentionally excludes the key; results are identical for all keys.
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    result = await call()
    _cache_put(cache_key, result, settings.sponsor_cache_s)
    return result


async def serpapi_extract(url: str) -> dict[str, Any]:
    """Fetch a page through SerpApi's Extract API. Returns markdown/text and a 'sample' flag on failure."""
    key = serpapi_key()
    settings = get_settings()
    if not key:
        return {"url": url, "text": f"Sample extracted content for {url}. Add SERPAPI_API_KEY for live extraction.",
                "provider": "demo", "degraded": True}
    cache_key = f"serpapi:extract:{url}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    params = urlencode({"api_key": key, "url": url, "output": "md"})
    target = f"{settings.serpapi_base_url.rstrip('/')}/extract?{params}"
    try:
        async with httpx.AsyncClient(transport=_transport, timeout=settings.sponsor_timeout_s) as client:
            resp = await client.get(target, headers={"Accept": "text/markdown, application/json, */*"})
        if resp.status_code >= 400:
            raise httpx.HTTPStatusError("extract failed", request=resp.request, response=resp)
        ctype = resp.headers.get("content-type", "")
        if "json" in ctype:
            data = resp.json()
            text = ""
            for k in ("markdown", "text", "body", "content"):
                if isinstance(data.get(k), str):
                    text = data[k]
                    break
        else:
            text = resp.text
        out = {"url": url, "text": text[:20000], "provider": "serpapi", "degraded": not bool(text)}
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        # The HTTPStatusError string carries the full URL with api_key=... — log only its type.
        log.info("SerpApi Extract failed (%s); using labelled sample data", type(exc).__name__)
        out = {"url": url, "text": f"Sample extracted content for {url}. Live extraction is unavailable.",
               "provider": "demo", "degraded": True}
    _cache_put(cache_key, out, settings.sponsor_cache_s)
    return out


# ---------------------------------------------------------------- You.com
def _you_headers() -> dict[str, str]:
    return {"X-API-Key": youcom_key(), "Content-Type": "application/json", "Accept": "application/json"}


async def _you_post(path: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """POST to You.com, trying the documented host and the legacy host before giving up."""
    settings = get_settings()
    bases = [settings.youcom_base_url.rstrip("/"), "https://ydc-index.io"]
    last_error: Exception | None = None
    for base in dict.fromkeys(bases):
        try:
            async with httpx.AsyncClient(transport=_transport, timeout=settings.sponsor_timeout_s) as client:
                resp = await client.post(f"{base}{path}", headers=_you_headers(), json=payload)
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, dict) else None
            if resp.status_code in (401, 403):
                last_error = httpx.HTTPStatusError(f"You.com auth {resp.status_code}", request=resp.request, response=resp)
                continue  # key may be scoped to the other host
            if resp.status_code >= 400:
                log.info("You.com %s returned %s", path, resp.status_code)
                return None
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            last_error = exc
    if last_error:
        log.info("You.com %s unavailable (%s)", path, type(last_error).__name__)
    return None


def _web_results(data: dict[str, Any] | None) -> list[Any]:
    """You.com may return results.web as a dict, a list, or omit it entirely."""
    results = (data or {}).get("results") or {}
    if isinstance(results, list):
        return results
    if not isinstance(results, dict):
        return []
    web = results.get("web") or []
    return web if isinstance(web, list) else []


def _excerpt_text(value: Any) -> str:
    """Citation excerpts arrive as a list, but tolerate a plain string too."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(str(x) for x in value[:2])
    return ""


def _normalise_you(item: dict[str, Any], *, query: str, position: int) -> SearchHit:
    contents = item.get("contents") or {}
    highlights = contents.get("highlights") if isinstance(contents, dict) else None
    summary = _first(item, "description", "snippet")
    if not summary and isinstance(highlights, list):
        summary = " ".join(str(x) for x in highlights[:3])
    if not summary and isinstance(item.get("snippets"), list):
        summary = " ".join(str(x) for x in item["snippets"][:3])
    url = _first(item, "url", "link", default="https://you.com/")
    return SearchHit(
        title=_first(item, "title", default=url), url=url, summary=summary[:1200],
        source=_first(item, "favicon_url") or (url.split("/")[2] if "://" in url else "you.com"),
        published_at=_first(item, "page_age", "date") or None,
        position=int(item.get("position") or position), provider="you.com", engine="search", query=query,
        extra={"thumbnail_url": item.get("thumbnail_url")} if item.get("thumbnail_url") else {},
    )


async def you_search(query: str, *, count: int = 5, freshness: str = "") -> list[SearchHit]:
    """Live web results from the You.com Web Search API (results are the citations we render)."""
    count = max(1, min(int(count), 20))
    if not youcom_key():
        log.info("You.com key not configured; returning sample results for %r", query)
        return demo_hits(query, provider="you.com", engine="search", count=count)
    settings = get_settings()
    cache_key = f"you:search:{query}:{count}:{freshness}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    payload: dict[str, Any] = {"query": query, "count": count}
    if freshness:
        payload["freshness"] = freshness
    data = await _you_post("/v1/search", payload)
    rows = _web_results(data)
    hits = [_normalise_you(row, query=query, position=i + 1) for i, row in enumerate(rows[:count]) if isinstance(row, dict)]
    if not hits:
        hits = demo_hits(query, provider="you.com", engine="search", count=count)
    _cache_put(cache_key, hits, settings.sponsor_cache_s)
    return hits


async def you_answer(query: str, *, country: str = "IN", language: str = "EN") -> CitedAnswer:
    """A synthesized answer with inline markers and verbatim citations from the You.com Answer API."""
    if not youcom_key():
        return demo_answer(query)
    settings = get_settings()
    cache_key = f"you:answer:{query}:{country}:{language}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    data = await _you_post("/v1/answer", {"query": query, "country": country, "language": language})
    answer_text = str((data or {}).get("answer") or "").strip()
    if not answer_text:
        out = demo_answer(query)
    else:
        citations = []
        for i, c in enumerate((data or {}).get("citations") or [], 1):
            if not isinstance(c, dict):
                continue
            source = _first(c, "source", "url")
            citations.append({
                "number": i, "source": source,
                "title": _first(c, "title") or (source.split("/")[2] if "://" in source else "Source"),
                "excerpt": _excerpt_text(c.get("excerpts"))[:800],
            })
        rows = _web_results(data)
        out = CitedAnswer(
            answer=answer_text, citations=citations,
            results=[_normalise_you(r, query=query, position=i + 1) for i, r in enumerate(rows[:10]) if isinstance(r, dict)],
            provider="you.com", degraded=False,
        )
    _cache_put(cache_key, out, settings.sponsor_cache_s)
    return out


# ---------------------------------------------------------------- combined helper
async def cited_evidence(query: str, *, max_sources: int = 5) -> tuple[str, list[dict[str, Any]]]:
    """Return (numbered evidence block, citation list) from You.com live results.

    Used by the comparison assistant so its answers are grounded in fresh web sources instead of stale, uncited
    model recall. If You.com is unavailable, SerpApi news results are used as a second live source.
    """
    hits = await you_search(query, count=max_sources)
    if not hits or all(h.provider == "demo" for h in hits):
        hits = await serpapi_search(query, engine="google_news", count=max_sources)
    citations: list[dict[str, Any]] = []
    lines: list[str] = []
    for i, hit in enumerate(hits[:max_sources], 1):
        citations.append({
            "number": i, "source": hit.url, "title": hit.title or hit.url,
            "excerpt": hit.summary[:400], "provider": hit.provider,
        })
        lines.append(f"[{i}] {hit.title} — {hit.summary[:300]} ({hit.url})")
    return "\n".join(lines), citations
