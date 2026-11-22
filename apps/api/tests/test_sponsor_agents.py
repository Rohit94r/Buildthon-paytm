"""The two sponsor engines are executable agents, not just API wrappers: steps produce FlowItems with
citation metadata and are visible in run logs."""

from __future__ import annotations

import httpx
import pytest

from app.core.config import reset_settings_cache
from app.services import sponsor

API = "/api/v1"


@pytest.fixture(autouse=True)
def _sponsor_clean():
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


async def _agent(c, name: str, kind: str, config: dict) -> dict:
    r = await c.post(f"{API}/agents", json={"name": name, "kind": kind, "config": config})
    assert r.status_code == 200, r.text
    return r.json()


async def test_serpapi_agent_emits_normalised_items(authed, monkeypatch):
    async def fake_search(query, **kw):
        return [
            sponsor.SearchHit(title="Live result", url="https://news.example/a", summary="Snippet",
                              source="Example News", position=1, provider="serpapi", engine=kw.get("engine", "google"), query=query),
            sponsor.SearchHit(title="Live result", url="https://news.example/a", summary="Duplicate",
                              source="Example News", position=2, provider="serpapi", engine="google", query=query),
        ]

    monkeypatch.setattr(sponsor, "serpapi_search", fake_search)
    a = await _agent(authed, "Live search", "serpapi_search", {"query": "AI agents", "engine": "google", "count": 5})
    res = (await authed.post(f"{API}/agents/{a['id']}/test", json={})).json()
    assert res["ok"], res
    assert len(res["items"]) == 1  # de-duplicated by URL
    assert res["items"][0]["url"] == "https://news.example/a"
    assert res["items"][0]["data"]["engine"] == "google"


async def test_you_research_agent_emits_citations(authed, monkeypatch):
    async def fake_answer(query, **kw):
        return sponsor.CitedAnswer(
            answer="Live answer [[1]]",
            citations=[{"number": 1, "source": "https://docs.example/a", "title": "Docs", "excerpt": "Evidence."}],
            results=[sponsor.SearchHit(title="Docs", url="https://docs.example/a", summary="Evidence.", provider="you.com")],
        )

    monkeypatch.setattr(sponsor, "you_answer", fake_answer)
    a = await _agent(authed, "Cited research", "you_research", {"question": "How do agents cite?", "mode": "answer"})
    res = (await authed.post(f"{API}/agents/{a['id']}/test", json={})).json()
    assert res["ok"], res
    item = res["items"][0]
    assert "[[1]]" in item["text"]
    assert item["data"]["citations"][0]["source"] == "https://docs.example/a"
    assert "Sources" in (item.get("formats") or {}).get("article", "")


async def test_you_research_search_mode(authed, monkeypatch):
    async def fake_search(query, **kw):
        return [sponsor.SearchHit(title="Fresh web", url="https://fresh.example/x", summary="Live snippet", provider="you.com")]

    monkeypatch.setattr(sponsor, "you_search", fake_search)
    a = await _agent(authed, "Cited brief", "you_research", {"question": "Latest pricing", "mode": "search", "count": 3})
    res = (await authed.post(f"{API}/agents/{a['id']}/test", json={})).json()
    assert res["ok"], res
    assert res["items"][0]["data"]["citations"][0]["title"] == "Fresh web"


async def test_livedesk_research_fans_out_to_both_sponsors(authed, keys):
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.path == "/v1/answer":
            return httpx.Response(200, json={
                "answer": "Agents cut research time. [[1]]",
                "citations": [{"source": "https://study.example/report", "title": "Agent study",
                               "excerpts": ["Agents cut research time by 40%."]}],
                "results": {"web": [{"url": "https://study.example/report", "title": "Agent study",
                                     "description": "A fresh study of agent workflows."}]},
            })
        if request.url.params.get("engine") == "google_news":
            return httpx.Response(200, json={"news_results": [
                {"position": 1, "title": "Agent news", "link": "https://news.example/a", "snippet": "This week.", "date": "1 day ago"}
            ]})
        return httpx.Response(200, json={"organic_results": [
            {"position": 1, "title": "Agent guide", "link": "https://web.example/a", "snippet": "A practical guide."}
        ]})

    sponsor.set_transport(httpx.MockTransport(handler))
    status = (await authed.get(f"{API}/livedesk/status")).json()
    assert status == {
        "keys": {"serpapi": True, "youcom": True}, "mode": "live",
        "engines": [{"key": k, "label": v} for k, v in
                    (("google", "Web"), ("google_news", "News"), ("google_jobs", "Jobs"),
                     ("google_shopping", "Shopping"), ("google_maps", "Maps"), ("google_scholar", "Scholar"))],
    }

    r = await authed.post(f"{API}/livedesk/research", json={
        "query": "AI agent research", "engines": ["google", "google_news"], "count": 4, "location": "India",
    })
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["answer"]["provider"] == "you.com" and "[[1]]" in out["answer"]["answer"]
    assert out["sources"][0]["source"] == "https://study.example/report"
    assert [c["label"] for c in out["collections"]] == ["Web", "News"]
    assert out["collections"][0]["hits"][0]["provider"] == "serpapi"
    assert out["collections"][1]["hits"][0]["engine"] == "google_news"
    assert "Agent study" in out["evidence"]
    assert out["degraded"] is False and out["keys"]["serpapi"] is True
    assert "/v1/answer" in seen
    assert sum(1 for p in seen if p == "/search.json") == 2


async def test_assistant_can_return_live_citations(authed, monkeypatch):
    async def fake_evidence(query, *, max_sources=5):
        return ("[1] Fresh result — a live snippet (https://live.example/a)", [
            {"number": 1, "title": "Fresh result", "source": "https://live.example/a",
             "excerpt": "a live snippet", "provider": "you.com"},
        ])

    monkeypatch.setattr(sponsor, "cited_evidence", fake_evidence)
    ds = (await authed.post(f"{API}/datasets", json={
        "name": "Live Labs", "key_field": "name",
        "fields": [{"key": "name", "label": "Name"}, {"key": "score", "label": "Score", "type": "number",
                    "compare": True, "higher_is_better": True}],
    })).json()
    await authed.post(f"{API}/datasets/{ds['id']}/records", json={"data": {"name": "North Lab", "score": 91}})

    plain = (await authed.post(f"{API}/assistant/chat", json={"dataset": ds["id"], "message": "Tell me about North Lab"})).json()
    assert plain["sources"] == [] and plain["sources_degraded"] is False

    live = (await authed.post(f"{API}/assistant/chat", json={
        "dataset": ds["id"], "message": "Tell me about North Lab", "live_sources": True,
    })).json()
    assert live["sources"][0]["source"] == "https://live.example/a"
    assert live["sources_degraded"] is False
    assert "Fresh result" in live["answer"]
