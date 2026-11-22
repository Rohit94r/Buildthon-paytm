"""Sponsor API clients: real request shapes, normalisation, caching, and graceful demo fallback.

The httpx transport is mocked, so these tests never spend SerpApi credits or You.com requests.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.config import reset_settings_cache
from app.services import sponsor


@pytest.fixture(autouse=True)
def _clean():
    sponsor.clear_cache()
    sponsor.set_transport(None)
    yield
    sponsor.set_transport(None)
    sponsor.clear_cache()


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "serpapi-test-key")
    monkeypatch.setenv("YOUCOM_API_KEY", "youcom-test-key")
    reset_settings_cache()
    yield
    monkeypatch.delenv("SERPAPI_API_KEY", raising=False)
    monkeypatch.delenv("YOUCOM_API_KEY", raising=False)
    reset_settings_cache()


@pytest.fixture
def short_serp_key(monkeypatch):
    # Empty env values override any keys loaded from a developer's local .env.
    monkeypatch.setenv("SERPAPI_API_KEY", "")
    monkeypatch.setenv("SERPAPI_KEY", "serpapi-short-key")
    reset_settings_cache()
    yield
    monkeypatch.delenv("SERPAPI_API_KEY", raising=False)
    monkeypatch.delenv("SERPAPI_KEY", raising=False)
    reset_settings_cache()


def test_missing_key_returns_labelled_sample_data(monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "")
    monkeypatch.setenv("SERPAPI_KEY", "")
    monkeypatch.setenv("YOUCOM_API_KEY", "")
    monkeypatch.setenv("YDC_API_KEY", "")
    reset_settings_cache()
    hits = __import__("asyncio").run(sponsor.serpapi_search("AI agents in Bengaluru", count=3))
    assert len(hits) == 3
    assert all(h.provider == "demo" for h in hits)
    assert all(h.url for h in hits)


async def test_serpapi_web_search_normalises_organic_results(keys):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={
            "organic_results": [
                {"position": 1, "title": "Result one", "link": "https://one.example/a",
                 "snippet": "First snippet", "source": "One", "date": "2 days ago"},
                {"position": 2, "title": "Result two", "link": "https://two.example/b", "snippet": "Second snippet"},
            ]
        })

    sponsor.set_transport(httpx.MockTransport(handler))
    hits = await sponsor.serpapi_search("agent platform", engine="google", gl="in", count=5)
    assert [h.title for h in hits] == ["Result one", "Result two"]
    assert hits[0].source == "One"
    assert hits[0].published_at == "2 days ago"
    assert hits[0].provider == "serpapi"
    q = seen[0].url.params
    assert q["engine"] == "google" and q["q"] == "agent platform" and q["api_key"] == "serpapi-test-key"


async def test_serpapi_short_key_alias_is_accepted(short_serp_key):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"organic_results": [
            {"position": 1, "title": "Alias result", "link": "https://alias.example/a", "snippet": "Works."}
        ]})

    sponsor.set_transport(httpx.MockTransport(handler))
    hits = await sponsor.serpapi_search("alias key", count=2)
    assert hits[0].title == "Alias result"
    assert seen[0].url.params["api_key"] == "serpapi-short-key"


async def test_serpapi_job_results(keys):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"jobs_results": [
            {"position": 1, "title": "AI Engineer", "company_name": "Acme", "location": "Bengaluru, India",
             "via": "LinkedIn", "apply_link": "https://jobs.example/1"}
        ]})

    sponsor.set_transport(httpx.MockTransport(handler))
    hits = await sponsor.serpapi_search("AI engineer jobs", engine="google_jobs")
    assert hits[0].url == "https://jobs.example/1"
    assert "Acme" in hits[0].summary and "Bengaluru" in hits[0].summary


async def test_you_search_reads_results_web(keys):
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.url.path == "/v1/search"
        assert request.headers["X-API-Key"] == "youcom-test-key"
        assert json.loads(request.content)["query"] == "live research agents"
        return httpx.Response(200, json={"results": {"web": [
            {"url": "https://research.example/study", "title": "A study", "description": "Useful description",
             "page_age": "2026-10-01T00:00:00", "snippets": ["A useful passage"]}
        ]}, "metadata": {"query": "live research agents"}})

    sponsor.set_transport(httpx.MockTransport(handler))
    hits = await sponsor.you_search("live research agents", count=3)
    assert hits[0].title == "A study"
    assert hits[0].summary == "Useful description"
    assert hits[0].provider == "you.com"


async def test_you_answer_maps_citations(keys):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/answer"
        return httpx.Response(200, json={
            "answer": "Agents use cited search. [[1]]",
            "citations": [{"source": "https://docs.example/agents", "excerpts": ["Agents use cited search."]}],
            "results": {"web": [{"url": "https://docs.example/agents", "title": "Agents docs",
                                 "snippets": ["Agents use cited search."]}]},
        })

    sponsor.set_transport(httpx.MockTransport(handler))
    out = await sponsor.you_answer("how do agents cite sources?")
    assert "[[1]]" in out.answer
    assert out.citations[0]["source"] == "https://docs.example/agents"
    assert out.results[0].title == "Agents docs"
    assert out.degraded is False


async def test_serpapi_extract_returns_markdown(keys):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="# Extracted page\nReal content.", headers={"content-type": "text/markdown"})

    sponsor.set_transport(httpx.MockTransport(handler))
    out = await sponsor.serpapi_extract("https://example.org/page")
    assert "Real content." in out["text"]
    assert out["provider"] == "serpapi"


async def test_network_failure_degrades_without_raising(keys):
    sponsor.set_transport(httpx.MockTransport(lambda request: (_ for _ in ()).throw(httpx.ConnectError("offline"))))
    hits = await sponsor.serpapi_search("anything", count=2)
    assert hits and all(h.provider == "demo" for h in hits)
    answer = await sponsor.you_answer("anything")
    assert answer.degraded is True
