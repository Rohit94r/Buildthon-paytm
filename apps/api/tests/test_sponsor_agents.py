"""The two sponsor engines are executable agents, not just API wrappers: steps produce FlowItems with
citation metadata and are visible in run logs."""

from __future__ import annotations

from app.services import sponsor

API = "/api/v1"


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
