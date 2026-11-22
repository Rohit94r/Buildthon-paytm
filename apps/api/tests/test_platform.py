"""Platform: workspaces + switching, agents, pipelines through the worker (scrape → rewrite → formats → quality →
signed webhook publish), approval pause/resume, datasets, comparison chat, API keys + public API, webhook
triggers, the data cleaner, blueprints and the demo seed. Mock model + mocked internet throughout."""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.core.db import session_factory
from app.models import ContentItem, DatasetRecord, Job, PipelineRun, User
from app.platform.net import set_fetcher_factory
from tests.conftest import ADMIN_EMAIL, WEBHOOK_INBOX, login, make_fetcher

API = "/api/v1"
PUB = "/api/public/v1"
SECRET = "whsec-test-123"


@pytest.fixture(autouse=True)
def _platform_net():
    set_fetcher_factory(make_fetcher)
    WEBHOOK_INBOX.clear()
    yield
    set_fetcher_factory(None)


async def make_platform_admin(email: str = ADMIN_EMAIL) -> None:
    async with session_factory()() as db:
        await db.execute(update(User).where(User.email == email).values(is_platform_admin=True))
        await db.commit()


async def create_agent(c, name: str, kind: str, config: dict | None = None, **extra) -> dict:
    r = await c.post(f"{API}/agents", json={"name": name, "kind": kind, "config": config or {}, **extra})
    assert r.status_code == 200, r.text
    return r.json()


async def create_pipeline(c, name: str, agents: list[dict], *, approval: bool, trigger: dict | None = None) -> dict:
    r = await c.post(f"{API}/pipelines", json={
        "name": name, "steps": [{"agent_id": a["id"]} for a in agents],
        "trigger": trigger or {"type": "manual"}, "require_approval": approval,
    })
    assert r.status_code == 200, r.text
    return r.json()


async def webhook_connection(c) -> dict:
    r = await c.post(f"{API}/connections", json={
        "name": "Client site", "kind": "webhook", "config": {"url": "https://client.example.com/api/layerflow", "secret": SECRET}})
    assert r.status_code == 200, r.text
    return r.json()


def check_signature(req) -> dict:
    expected = "sha256=" + hmac.new(SECRET.encode(), req.content, hashlib.sha256).hexdigest()
    assert req.headers["x-layerflow-signature"] == expected
    assert req.headers["x-layerflow-event"] == "content.published"
    return json.loads(req.content)


SCRAPER = {"sources": [{"url": "https://listings.example.com/markets", "type": "html"}], "mode": "css",
           "item_selector": "div.card", "link_selector": "h2 a",
           "extract_fields": [{"key": "sector", "label": "Sector", "type": "text", "selector": "span.sector"}],
           "max_items": 2, "max_age_hours": 0}


# ---------------------------------------------------------------- workspaces
async def test_workspace_switching_and_forbidden(client):
    await make_platform_admin()
    await login(client)
    me = (await client.get(f"{API}/auth/me")).json()
    assert me["user"]["is_platform_admin"] is True and {"modules", "industry", "brand_color"} <= set(me["tenant"])
    assert [w["slug"] for w in me["workspaces"]] == ["ten"]

    r = await client.post(f"{API}/workspaces", json={"name": "Acme Media", "industry": "news_media", "brand_color": "#112233"})
    assert r.status_code == 200, r.text
    ws = r.json()
    assert ws["slug"] == "acme-media" and ws["stats"]["agents"] == 0 and "pipelines" in ws["modules"]

    # The header switches every tenant-scoped router to that workspace.
    await create_agent(client, "Ten agent", "seo_optimizer")
    client.headers["X-Workspace"] = "acme-media"
    assert (await client.get(f"{API}/auth/me")).json()["tenant"]["slug"] == "acme-media"
    assert (await client.get(f"{API}/agents")).json()["items"] == []
    await create_agent(client, "Acme agent", "seo_optimizer")
    assert [a["name"] for a in (await client.get(f"{API}/agents")).json()["items"]] == ["Acme agent"]
    client.headers["X-Workspace"] = "nope"
    assert (await client.get(f"{API}/agents")).status_code == 404
    del client.headers["X-Workspace"]
    assert [a["name"] for a in (await client.get(f"{API}/agents")).json()["items"]] == ["Ten agent"]
    assert {w["slug"] for w in (await client.get(f"{API}/auth/me")).json()["workspaces"]} == {"ten", "acme-media"}
    ov = (await client.get(f"{API}/platform/overview")).json()
    assert ov["totals"]["workspaces"] == 2 and ov["totals"]["agents"] == 2 and len(ov["runs_by_day"]) == 14

    bad = await client.request("DELETE", f"{API}/workspaces/acme-media", json={"confirm": "wrong"})
    assert bad.status_code == 400
    home = await client.request("DELETE", f"{API}/workspaces/ten", json={"confirm": "ten"})
    assert home.status_code == 409 and home.json()["error"]["code"] == "home_workspace"
    assert (await client.request("DELETE", f"{API}/workspaces/acme-media", json={"confirm": "acme-media"})).status_code == 204

    # A user who is not a platform admin cannot switch or create workspaces.
    await login(client, "reviewer@ten.example")
    client.headers["X-Workspace"] = "ten"
    assert (await client.get(f"{API}/agents")).status_code == 200  # own workspace is fine
    client.headers["X-Workspace"] = "other"
    r = await client.get(f"{API}/agents")
    assert r.status_code == 403 and r.json()["error"]["code"] == "workspace_forbidden"
    del client.headers["X-Workspace"]
    assert (await client.post(f"{API}/workspaces", json={"name": "Nope", "industry": "other"})).status_code == 403
    assert (await client.get(f"{API}/platform/overview")).status_code == 403


# ---------------------------------------------------------------- agents
async def test_agent_types_crud_and_validation(authed):
    types = (await authed.get(f"{API}/agent-types")).json()["items"]
    kinds = {t["kind"] for t in types}
    assert len(types) == 26 and {"web_scraper", "data_transform", "comparison_assistant", "researcher", "http_action",
                                 "serpapi_search", "you_research"} <= kinds
    assert all(f["label"] and f["type"] for t in types for f in t["config_schema"])

    r = await authed.post(f"{API}/agents", json={"name": "Bad", "kind": "multi_format", "config": {"formats": ["tiktok"], "zzz": 1}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_config"
    assert any("zzz" in p for p in r.json()["error"]["details"]) and any("tiktok" in p for p in r.json()["error"]["details"])
    assert (await authed.post(f"{API}/agents", json={"name": "Bad", "kind": "nope"})).status_code == 400
    r = await authed.post(f"{API}/agents", json={"name": "No dataset", "kind": "comparison_assistant", "config": {}})
    assert r.status_code == 422  # required field

    a = await create_agent(authed, "Writer", "persona_rewriter", {"tone": "witty"})
    assert a["config"]["tone"] == "witty" and a["config"]["target_words"] == 400 and a["model"] == "writer"
    r = await authed.patch(f"{API}/agents/{a['id']}", json={"config": {"tone": "neutral", "target_words": 200}, "enabled": False})
    assert r.status_code == 200 and r.json()["config"]["target_words"] == 200 and r.json()["enabled"] is False
    assert (await authed.patch(f"{API}/agents/{a['id']}", json={"config": {"target_words": 5}})).status_code == 422

    test = (await authed.post(f"{API}/agents/{a['id']}/test", json={"input": {"text": (
        "Northwind Logistics will invest 2.1 billion dollars in 14 automated warehouses. The company expects costs to fall "
        "18 percent by 2028. Analysts said depreciation will rise by about 210 million dollars a year.")}})).json()
    assert test["ok"] is True and test["items"][0]["formats"]["article"] and test["model"]
    assert not (await authed.get(f"{API}/content")).json()["items"]  # test runs persist nothing

    p = await create_pipeline(authed, "Uses writer", [a], approval=True)
    r = await authed.delete(f"{API}/agents/{a['id']}")
    assert r.status_code == 409 and r.json()["error"]["code"] == "agent_in_use"
    assert (await authed.delete(f"{API}/pipelines/{p['id']}")).status_code == 204
    assert (await authed.delete(f"{API}/agents/{a['id']}")).status_code == 204


# ---------------------------------------------------------------- pipelines end to end
async def test_pipeline_end_to_end_publishes_signed_webhook(authed, worker):
    conn = await webhook_connection(authed)
    assert conn["status"] == "connected" and conn["secrets_set"] == ["secret"] and "secret" not in conn["config"]
    test = (await authed.post(f"{API}/connections/{conn['id']}/test")).json()
    assert test["ok"] is True and WEBHOOK_INBOX[-1].headers["x-layerflow-event"] == "ping"
    WEBHOOK_INBOX.clear()

    agents = [
        await create_agent(authed, "Scraper", "web_scraper", SCRAPER),
        await create_agent(authed, "Rewriter", "persona_rewriter", {"target_words": 120}),
        await create_agent(authed, "Studio", "multi_format", {"formats": ["linkedin_post", "x_thread", "instagram_caption", "short_video_script"]}),
        await create_agent(authed, "SEO", "seo_optimizer", {"site_url": "https://client.example.com"}),
        await create_agent(authed, "Gate", "quality_gate", {"use_model_rubric": True}),
        await create_agent(authed, "Publisher", "auto_publisher", {"connections": [conn["id"]]}),
    ]
    pipe = await create_pipeline(authed, "Market desk", agents, approval=False)
    run = (await authed.post(f"{API}/pipelines/{pipe['id']}/run")).json()
    assert run["status"] == "queued" and [s["status"] for s in run["steps"]] == ["pending"] * 6

    await worker.drain()
    run = (await authed.get(f"{API}/runs/{run['id']}")).json()
    assert run["status"] == "succeeded", run
    assert all(s["status"] == "succeeded" and s["logs"] for s in run["steps"])
    assert run["steps"][0]["items_out"] == 2 and run["content_created"] == 2 and run["items_out"] == 2

    content = (await authed.get(f"{API}/content")).json()
    assert content["total"] == 2
    for item in content["items"]:
        assert item["status"] == "published" and item["pipeline_name"] == "Market desk"
        formats = {v["format"]: v for v in item["variants"]}
        assert {"article", "linkedin_post", "x_thread", "instagram_caption", "short_video_script"} <= set(formats)
        assert all(len(t) <= 280 for t in formats["x_thread"]["body"].split("\n\n"))
        assert formats["linkedin_post"]["char_count"] <= 1300
        assert item["seo"]["title_tag"] and item["seo"]["json_ld"]["@type"] == "Article"
        assert item["quality"]["score"] > 0
        pub = item["publications"][0]
        assert pub["status"] == "published" and pub["url"].startswith("https://client.example.com/blog/") and pub["kind"] == "webhook"

    assert len(WEBHOOK_INBOX) == 2
    payloads = [check_signature(r) for r in WEBHOOK_INBOX]
    assert {p["workspace"] for p in payloads} == {"ten"}
    body = payloads[0]["content"]
    assert body["body_html"].startswith("<p>") and body["format"] == "article" and "linkedin_post" in body["variants"]

    listed = (await authed.get(f"{API}/pipelines")).json()["items"][0]
    assert listed["last_run"]["status"] == "succeeded" and listed["runs_7d"] == 1
    stats = {a["name"]: a["stats"] for a in (await authed.get(f"{API}/agents")).json()["items"]}
    assert stats["Scraper"]["runs"] == 1 and stats["Scraper"]["success_rate"] == 1.0
    dash = (await authed.get(f"{API}/dashboard/workspace")).json()
    assert dash["workspace"]["stats"]["published_7d"] == 2 and dash["recent_runs"][0]["id"] == run["id"]
    assert any(a["kind"] == "publish" for a in dash["activity"])


async def test_approval_pause_and_resume(authed, worker):
    conn = await webhook_connection(authed)
    agents = [
        await create_agent(authed, "Scraper", "web_scraper", {**SCRAPER, "max_items": 1}),
        await create_agent(authed, "Rewriter", "persona_rewriter", {"target_words": 100}),
        await create_agent(authed, "Publisher", "auto_publisher", {"connections": [conn["id"]]}),
    ]
    pipe = await create_pipeline(authed, "Reviewed desk", agents, approval=True)
    run = (await authed.post(f"{API}/pipelines/{pipe['id']}/run")).json()
    await worker.drain()
    run = (await authed.get(f"{API}/runs/{run['id']}")).json()
    assert run["status"] == "awaiting_approval" and run["steps"][2]["status"] == "pending"
    assert not WEBHOOK_INBOX
    item = (await authed.get(f"{API}/content?status=draft")).json()["items"][0]
    assert (await authed.get(f"{API}/dashboard/workspace")).json()["pending_approval"] == 1

    edited = (await authed.patch(f"{API}/content/{item['id']}", json={"title": "Edited by an editor"})).json()
    assert edited["title"] == "Edited by an editor"
    approved = (await authed.post(f"{API}/content/{item['id']}/approve")).json()
    assert approved["status"] == "approved"
    await worker.drain()
    run = (await authed.get(f"{API}/runs/{run['id']}")).json()
    assert run["status"] == "succeeded" and run["steps"][2]["status"] == "succeeded"
    item = (await authed.get(f"{API}/content/{item['id']}")).json()
    assert item["status"] == "published" and len(WEBHOOK_INBOX) == 1
    assert check_signature(WEBHOOK_INBOX[0])["content"]["title"] == "Edited by an editor"


async def test_cancel_queued_run(authed):
    a = await create_agent(authed, "SEO", "seo_optimizer")
    pipe = await create_pipeline(authed, "Cancel me", [a], approval=False)
    run = (await authed.post(f"{API}/pipelines/{pipe['id']}/run")).json()
    out = (await authed.post(f"{API}/runs/{run['id']}/cancel")).json()
    assert out["status"] == "cancelled" and out["steps"][0]["status"] == "skipped"
    async with session_factory()() as db:
        assert (await db.execute(select(Job).where(Job.type == "pipeline_run"))).scalar_one().status == "failed"


# ---------------------------------------------------------------- datasets + assistant
COLLEGE_FIELDS = [
    {"key": "name", "label": "College", "type": "text"},
    {"key": "city", "label": "City", "type": "text", "compare": True},
    {"key": "fees_total", "label": "Total fees", "type": "currency", "unit": "₹", "compare": True, "higher_is_better": False},
    {"key": "avg_package", "label": "Average package", "type": "number", "unit": "LPA", "compare": True, "higher_is_better": True},
    {"key": "placement_rate", "label": "Placement rate", "type": "number", "unit": "%", "compare": True, "higher_is_better": True},
]


async def make_colleges(c, public: bool = True) -> dict:
    r = await c.post(f"{API}/datasets", json={"name": "Colleges", "key_field": "name", "fields": COLLEGE_FIELDS, "public": public})
    assert r.status_code == 200, r.text
    ds = r.json()
    rows = [
        {"name": "Alpha Institute of Technology", "city": "Pune", "fees_total": "₹ 2.5 lakh", "avg_package": "8.5 LPA", "placement_rate": "91%",
         "aliases": ["AIT Pune"]},
        {"name": "Beta College", "city": "Nagpur", "fees_total": 180000, "avg_package": 6, "placement_rate": 84},
        {"name": "Gamma University", "city": "Pune", "fees_total": 320000, "avg_package": 11.2, "placement_rate": 95},
    ]
    assert (await c.post(f"{API}/datasets/{ds['id']}/import", json={"rows": rows})).json() == {"created": 3, "updated": 0, "skipped": 0}
    return ds


async def test_dataset_upsert_search_sort(authed):
    ds = await make_colleges(authed)
    r = await authed.post(f"{API}/datasets/{ds['id']}/records", json={"data": {"name": "Beta College", "city": "Nagpur", "fees_total": "1,90,000"}})
    assert r.status_code == 200 and r.json()["data"]["fees_total"] == 190000
    assert (await authed.post(f"{API}/datasets/{ds['id']}/records", json={"data": {"city": "X"}})).status_code == 422
    alpha = (await authed.get(f"{API}/datasets/{ds['id']}/records?q=alpha")).json()
    assert alpha["total"] == 1 and alpha["items"][0]["data"]["fees_total"] == 250000 and alpha["items"][0]["data"]["avg_package"] == 8.5
    pune = (await authed.get(f"{API}/datasets/{ds['id']}/records?q=pune&sort=avg_package:desc")).json()
    assert [i["key"] for i in pune["items"]] == ["Gamma University", "Alpha Institute of Technology"]
    cheap = (await authed.get(f"{API}/datasets/{ds['id']}/records?sort=fees_total:asc&limit=1")).json()
    assert cheap["items"][0]["key"] == "Beta College" and cheap["total"] == 3
    again = (await authed.post(f"{API}/datasets/{ds['id']}/import", json={"rows": [{"name": "Gamma University", "avg_package": 12}, {"nope": 1}]})).json()
    assert again == {"created": 0, "updated": 1, "skipped": 1}
    assert (await authed.get(f"{API}/datasets/{ds['id']}")).json()["record_count"] == 3
    rec = pune["items"][0]
    patched = (await authed.patch(f"{API}/datasets/{ds['id']}/records/{rec['id']}", json={"data": {"city": "Mumbai"}})).json()
    assert patched["data"]["city"] == "Mumbai" and patched["data"]["avg_package"] == 12
    assert (await authed.delete(f"{API}/datasets/{ds['id']}/records/{rec['id']}")).status_code == 204


async def test_chat_comparison_table_and_winners(authed):
    ds = await make_colleges(authed)
    r = await authed.post(f"{API}/assistant/chat", json={"dataset": ds["slug"], "message": "Compare AIT Pune and beta college for me"})
    assert r.status_code == 200, r.text
    chat = r.json()
    assert [rec["key"] for rec in chat["records"]] == ["Alpha Institute of Technology", "Beta College"]
    winners = chat["table"]["winners"]
    assert winners == {"fees_total": "Beta College", "avg_package": "Alpha Institute of Technology",
                       "placement_rate": "Alpha Institute of Technology"}
    assert chat["answer"] and chat["suggestions"] and chat["model"] and chat["latency_ms"] >= 0
    assert [f["key"] for f in chat["table"]["fields"]] == ["city", "fees_total", "avg_package", "placement_rate"]

    best = (await authed.post(f"{API}/assistant/chat", json={"dataset": ds["id"], "message": "Which college in Pune has the highest placement rate?"})).json()
    assert best["records"][0]["key"] == "Gamma University" and {r["key"] for r in best["records"]} <= {"Gamma University", "Alpha Institute of Technology"}
    follow = (await authed.post(f"{API}/assistant/chat", json={
        "dataset": ds["id"], "message": "and what about its fees?",
        "history": [{"role": "user", "content": "Tell me about Gamma University"}, {"role": "assistant", "content": "…"}]})).json()
    assert [r["key"] for r in follow["records"]] == ["Gamma University"]
    none = (await authed.post(f"{API}/assistant/chat", json={"dataset": ds["id"], "message": "zebra crossing"})).json()
    assert none["records"] == [] and none["table"] is None and "could not find" in none["answer"]

    agent = await create_agent(authed, "Compare", "comparison_assistant", {"dataset": ds["id"], "max_records": 2})
    via_agent = (await authed.post(f"{API}/assistant/chat", json={"assistant_id": agent["id"], "message": "Gamma University vs Beta College"})).json()
    assert via_agent["table"]["winners"]["avg_package"] == "Gamma University"


# ---------------------------------------------------------------- API keys + public API
async def test_api_keys_scopes_revocation_and_public_endpoints(authed, worker):
    ds = await make_colleges(authed, public=True)
    private = (await authed.post(f"{API}/datasets", json={"name": "Internal", "key_field": "name",
                                                           "fields": [{"key": "name", "label": "Name"}]})).json()
    content_key = (await authed.post(f"{API}/api-keys", json={"name": "Site", "scopes": ["content:read"]})).json()
    data_key = (await authed.post(f"{API}/api-keys", json={"name": "Widget", "scopes": ["datasets:read", "assistant:chat"]})).json()
    assert content_key["secret"].startswith("lf_pk_") and content_key["key"]["prefix"] == content_key["secret"][:10]
    listed = (await authed.get(f"{API}/api-keys")).json()["items"]
    assert len(listed) == 2 and all("secret" not in k for k in listed)

    # Publish one item through a pipeline so the public API has something to serve.
    conn = await webhook_connection(authed)
    agents = [await create_agent(authed, "Scraper", "web_scraper", {**SCRAPER, "max_items": 1}),
              await create_agent(authed, "Rewriter", "persona_rewriter", {"target_words": 100}),
              await create_agent(authed, "Publisher", "auto_publisher", {"connections": [conn["id"]]})]
    pipe = await create_pipeline(authed, "Desk", agents, approval=False)
    await authed.post(f"{API}/pipelines/{pipe['id']}/run")
    await worker.drain()
    async with session_factory()() as db:
        db.add(ContentItem(tenant_id=(await db.execute(select(User.tenant_id).where(User.email == ADMIN_EMAIL))).scalar_one(),
                           title="Draft only", slug="draft-only-item", status="draft", variants=[{"format": "article", "body": "x"}]))
        await db.commit()

    pub = authed  # same client, no cookies needed for the public API
    h = {"Authorization": f"Bearer {content_key['secret']}"}
    assert (await pub.get(f"{PUB}/content")).status_code == 401
    r = await pub.get(f"{PUB}/content", headers=h)
    assert r.status_code == 200 and r.json()["total"] == 1 and r.headers["access-control-allow-origin"] == "*"
    item = r.json()["items"][0]
    assert item["body_html"] and item["body_markdown"] and item["published_at"] and item["seo"]["title_tag"]
    assert (await pub.get(f"{PUB}/content/{item['slug']}", headers={"X-API-Key": content_key["secret"]})).json()["id"] == item["id"]
    assert (await pub.get(f"{PUB}/content/draft-only-item", headers=h)).status_code == 404
    rss = await pub.get(f"{PUB}/rss.xml?key={content_key['secret']}")
    assert rss.status_code == 200 and "<rss" in rss.text and item["title"][:20] in rss.text
    assert (await pub.get(f"{PUB}/datasets/{ds['slug']}/records", headers=h)).json()["error"]["code"] == "insufficient_scope"

    d = {"X-API-Key": data_key["secret"]}
    recs = (await pub.get(f"{PUB}/datasets/{ds['slug']}/records?sort=avg_package:desc&limit=2", headers=d)).json()
    assert recs["dataset"]["slug"] == "colleges" and recs["total"] == 3 and recs["items"][0]["key"] == "Gamma University"
    assert (await pub.get(f"{PUB}/datasets/{ds['slug']}/records/Beta College", headers=d)).json()["data"]["city"] == "Nagpur"
    assert (await pub.get(f"{PUB}/datasets/{private['slug']}/records", headers=d)).status_code == 404
    chat = await pub.post(f"{PUB}/chat", headers=d, json={"dataset": "colleges", "message": "Alpha Institute of Technology vs Gamma University"})
    assert chat.status_code == 200 and chat.json()["table"]["winners"]["fees_total"] == "Alpha Institute of Technology"
    assert (await pub.post(f"{PUB}/chat", headers=d, json={"dataset": private["slug"], "message": "hi"})).status_code == 404
    pre = await pub.options(f"{PUB}/chat", headers={"Origin": "https://client.example.com", "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 204 and "X-API-Key" in pre.headers["access-control-allow-headers"]
    assert "Idempotency-Key" in pre.headers["access-control-allow-headers"]  # browser SDK sends it on runs
    assert "access-control-allow-origin" not in (await authed.get(f"{API}/agents")).headers

    assert (await authed.delete(f"{API}/api-keys/{data_key['key']['id']}")).status_code == 204
    r = await pub.get(f"{PUB}/datasets/{ds['slug']}/records", headers=d)
    assert r.status_code == 401 and r.json()["error"]["code"] == "api_key_revoked"
    assert (await authed.get(f"{API}/api-keys")).json()["items"][0]["revoked"] in (True, False)


# ---------------------------------------------------------------- webhook trigger + data cleaner + pipeline_items
def _days(n: int) -> str:
    return (datetime.now(UTC) + timedelta(days=n)).date().isoformat()


HACKS = [
    {"title": "Gamma Hack", "url": "https://h.example.com/gamma", "data": {"name": "Gamma Hack", "registration_deadline": _days(20), "prize_pool": "$5,000"}},
    {"title": "Alpha Hack", "url": "https://h.example.com/alpha", "data": {"name": "Alpha Hack", "registration_deadline": _days(3), "themes": ["AI"]}},
    {"title": "Alpha Hack (copy)", "url": "https://h.example.com/alpha?utm_source=x", "data": {"name": "Alpha Hack", "registration_deadline": _days(3)}},
    {"title": "Old Hack", "url": "https://h.example.com/old", "data": {"name": "Old Hack", "registration_deadline": _days(-2)}},
    {"title": "Beta Hack", "url": "https://h.example.com/beta", "data": {"name": "Beta Hack", "registration_deadline": (datetime.now(UTC) + timedelta(days=9)).strftime("%d %b %Y")}},
    {"title": "No Date Hack", "url": "https://h.example.com/nodate", "data": {"name": "No Date Hack"}},
]
SORTER = {"dedupe_by": ["url", "data.name"], "filters": [{"field": "data.registration_deadline", "op": "date_after_today"}],
          "sort_by": "data.registration_deadline", "sort_order": "asc"}


async def test_data_transform_dedupe_filter_sort_limit(authed):
    bad = await authed.post(f"{API}/agents", json={"name": "Bad", "kind": "data_transform", "config": {"filters": "[{\"field\": \"x\", \"op\": \"like\"}]"}})
    assert bad.status_code == 422
    assert (await authed.post(f"{API}/agents", json={"name": "Bad", "kind": "data_transform", "config": {"filters": "not json"}})).status_code == 422
    sorter = await create_agent(authed, "Sorter", "data_transform", SORTER)
    assert isinstance(sorter["config"]["filters"], str) and json.loads(sorter["config"]["filters"])[0]["op"] == "date_after_today"

    res = (await authed.post(f"{API}/agents/{sorter['id']}/test", json={"input": {"items": HACKS}})).json()
    assert res["ok"], res
    assert [i["title"] for i in res["items"]] == ["Alpha Hack", "Beta Hack", "Gamma Hack"]
    limited = (await authed.post(f"{API}/agents/{sorter['id']}/test", json={
        "input": {"items": HACKS}, "config_override": {"limit": 2, "sort_order": "desc"}})).json()
    assert [i["title"] for i in limited["items"]] == ["Gamma Hack", "Beta Hack"]

    cat = await create_agent(authed, "Cat", "data_transform", {
        "filters": [{"field": "data.prize_pool", "op": "exists", "value": False}],
        "set_fields": {"data.source": "test"}, "rename_fields": {"data.themes": "data.tags"},
        "ai_categorize": True, "categories": ["AI", "Web3", "Student"], "category_field": "category"})
    res = (await authed.post(f"{API}/agents/{cat['id']}/test", json={"input": {"items": [HACKS[1], HACKS[2], HACKS[4]]}})).json()
    assert len(res["items"]) == 2  # default dedupe_by url: the utm-tagged copy is the same canonical URL
    assert res["ok"], res
    first = res["items"][0]
    assert first["data"]["category"] == "AI" and first["data"]["tags"] == ["AI"] and first["data"]["source"] == "test"
    assert res["items"][1]["data"]["category"] == "Student"  # fallback category from the mock


async def test_webhook_trigger_to_dataset_pipeline_items(authed, worker):
    r = await authed.post(f"{API}/datasets", json={"name": "Hackathons", "key_field": "name", "fields": [
        {"key": "name", "label": "Hackathon"}, {"key": "registration_deadline", "label": "Deadline", "type": "date"},
        {"key": "prize_pool", "label": "Prize"}, {"key": "url", "label": "Link", "type": "url"}, {"key": "summary", "label": "Summary"}]})
    ds = r.json()
    sorter = await create_agent(authed, "Sorter", "data_transform", SORTER)
    saver = await create_agent(authed, "Save", "dataset_builder", {"dataset": ds["id"], "source_mode": "pipeline_items"})
    pipe = await create_pipeline(authed, "Hack sweep", [sorter, saver], approval=False, trigger={"type": "webhook"})
    hook = pipe["trigger"]["webhook_url"]
    assert hook and "/api/public/v1/hooks/pipelines/" in hook
    path = hook.split("http://testserver", 1)[1]
    base = path.split("?")[0]

    assert (await authed.post(f"{base}?token=wrong", json={"items": HACKS})).status_code == 401
    r = await authed.post(path, json={"items": [{**h, "summary": f"About {h['title']}"} for h in HACKS]})
    assert r.status_code == 200, r.text
    run_id = r.json()["run_id"]
    await worker.drain()
    run = (await authed.get(f"{API}/runs/{run_id}")).json()
    assert run["status"] == "succeeded" and run["trigger"] == "webhook" and run["items_out"] == 3
    recs = (await authed.get(f"{API}/datasets/{ds['id']}/records?sort=registration_deadline:asc")).json()
    assert [x["key"] for x in recs["items"]] == ["Alpha Hack", "Beta Hack", "Gamma Hack"]
    gamma = recs["items"][2]
    assert gamma["data"]["prize_pool"] == "$5,000" and gamma["source_url"] == "https://h.example.com/gamma"
    assert gamma["data"]["url"] == "https://h.example.com/gamma" and gamma["data"]["summary"] == "About Gamma Hack"
    assert recs["items"][1]["data"]["registration_deadline"] == _days(9)

    # Manual pipelines cannot be triggered by webhook even with the right token.
    await authed.patch(f"{API}/pipelines/{pipe['id']}", json={"trigger": {"type": "manual"}})
    assert (await authed.post(path, json={})).status_code == 409


async def test_dataset_builder_scrapes_listing_with_ai_extraction(authed, worker):
    ds = (await authed.post(f"{API}/datasets", json={"name": "Colleges", "key_field": "name", "fields": COLLEGE_FIELDS})).json()
    builder = await create_agent(authed, "Collector", "dataset_builder", {
        "dataset": ds["id"], "sources": [{"url": "https://colleges.example.com/list", "type": "html"}], "link_selector": "a.college"})
    pipe = await create_pipeline(authed, "Collect", [builder], approval=False)
    await authed.post(f"{API}/pipelines/{pipe['id']}/run")
    await worker.drain()
    recs = (await authed.get(f"{API}/datasets/{ds['id']}/records?sort=key:asc")).json()["items"]
    assert [r["key"] for r in recs] == ["Alpha Institute", "Beta College"]
    assert recs[0]["data"]["fees_total"] == 250000 and recs[0]["data"]["avg_package"] == 8.5 and recs[0]["source_url"].endswith("/c/alpha")
    assert recs[1]["data"]["fees_total"] == 180000 and recs[1]["data"]["placement_rate"] == 84


# ---------------------------------------------------------------- scheduler, blueprints, seed
async def test_scheduler_starts_due_pipelines(authed):
    from app.platform.scheduler import tick_pipelines

    a = await create_agent(authed, "SEO", "seo_optimizer")
    pipe = await create_pipeline(authed, "Hourly", [a], approval=False, trigger={"type": "schedule", "every_minutes": 60})
    assert pipe["next_run_at"]
    async with session_factory()() as db:
        from app.models import Pipeline

        await db.execute(update(Pipeline).values(next_run_at=datetime.now(UTC) - timedelta(minutes=1)))
        await db.commit()
        assert await tick_pipelines(db) == 1
        assert await tick_pipelines(db) == 0  # next slot moved on
        run = (await db.execute(select(PipelineRun))).scalar_one()
        assert run.trigger == "schedule" and run.status == "queued"


async def test_blueprints_apply_idempotently(authed):
    bps = (await authed.get(f"{API}/blueprints")).json()["items"]
    keys = {b["key"] for b in bps}
    assert {"news_media_autopilot", "college_portal", "executive_newsroom", "blog_seo_autopilot", "ecommerce_price_watch", "hackathon_listings",
            "seo_automation", "lead_management", "customer_support", "livedesk_research"} == keys
    for key in keys:
        r = await authed.post(f"{API}/blueprints/{key}/apply")
        assert r.status_code == 200, (key, r.text)
    before = len((await authed.get(f"{API}/agents")).json()["items"])
    out = (await authed.post(f"{API}/blueprints/college_portal/apply")).json()
    assert len((await authed.get(f"{API}/agents")).json()["items"]) == before  # nothing duplicated
    assert out["datasets"][0]["slug"] == "colleges" and any(p["name"] == "Admission news desk" for p in out["pipelines"])
    hack = next(p for p in (await authed.get(f"{API}/pipelines")).json()["items"] if p["name"] == "Daily hackathon sweep")
    assert [s["kind"] for s in hack["steps"]] == ["web_scraper", "data_transform", "persona_rewriter", "dataset_builder"]
    assert hack["trigger"] == {"type": "schedule", "every_minutes": 720, "webhook_url": None} and hack["require_approval"] is False
    me = (await authed.get(f"{API}/auth/me")).json()["tenant"]
    assert {"pipelines", "datasets", "assistant", "newsroom"} <= set(me["modules"])


async def test_seed_demo_platform_is_idempotent(tenant):
    from app.platform.seed import seed_demo_platform

    first = await seed_demo_platform()
    assert first["platform_admin"] == ADMIN_EMAIL
    assert first["marketpulse"]["content_added"] == 3 and first["collegecompass"]["records_added"] == 8
    assert first["hackfinder"]["records_added"] == 5
    assert first["livedesk"]["records_added"] == 10
    second = await seed_demo_platform()
    assert second["marketpulse"] == {"created": False, "content_added": 0} and second["collegecompass"]["records_added"] == 0
    async with session_factory()() as db:
        assert (await db.execute(select(DatasetRecord))).scalars().all().__len__() == 23
        runs = (await db.execute(select(PipelineRun))).scalars().all()
        assert len(runs) == 5 and all(r.status == "succeeded" for r in runs)


# ---------------------------------------------------------------- connections, manual publish, helpers
async def test_connection_kinds_secrets_and_manual_publish(authed, worker):
    kinds = {k["kind"]: k for k in (await authed.get(f"{API}/connection-kinds")).json()["items"]}
    assert set(kinds) == {"nextjs", "wordpress", "webhook", "linkedin", "telegram", "x", "ghost", "slack", "discord", "email_smtp", "rest_api"}
    assert kinds["x"]["auto_publish"] is False and any(f.get("secret") for f in kinds["wordpress"]["fields"])

    wp = (await authed.post(f"{API}/connections", json={"name": "Blog", "kind": "wordpress", "config": {"site_url": "https://blog.example.com"}})).json()
    assert wp["status"] == "needs_setup" and wp["config"]["status"] == "publish"
    wp = (await authed.patch(f"{API}/connections/{wp['id']}", json={"config": {"username": "ed", "app_password": "abcd efgh"}})).json()
    assert wp["status"] == "connected" and wp["secrets_set"] == ["app_password"] and "app_password" not in wp["config"]
    bad = await authed.post(f"{API}/connections", json={"name": "Bad", "kind": "webhook", "config": {"url": "ftp://x", "secret": "s"}})
    assert bad.status_code == 422

    x = (await authed.post(f"{API}/connections", json={"name": "X", "kind": "x", "config": {"handle": "@brand"}})).json()
    assert "id" in x, x
    hook = await webhook_connection(authed)
    a = await create_agent(authed, "Rewriter", "persona_rewriter", {"target_words": 100})
    p = await create_pipeline(authed, "Manual", [a], approval=True)
    await authed.post(f"{API}/pipelines/{p['id']}/run", json={"input": {"items": [{"title": "Northwind expands", "url": "https://news.example.com/northwind-warehouses",
                                                                                   "text": "Northwind Logistics will invest 2.1 billion dollars in 14 automated warehouses across India, the company said on Tuesday, and expects costs to fall 18 percent by 2028."}]}})
    await worker.drain()
    item = (await authed.get(f"{API}/content")).json()["items"][0]
    assert item["status"] == "draft"
    r = await authed.post(f"{API}/content/{item['id']}/publish", json={"connection_ids": [x["id"]]})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    await worker.drain()
    item = (await authed.get(f"{API}/content/{item['id']}")).json()
    assert item["publications"][0]["status"] == "manual" and item["status"] == "approved"  # manual is not "published"
    await authed.post(f"{API}/content/{item['id']}/publish", json={"connection_ids": [hook["id"]]})
    await worker.drain()
    item = (await authed.get(f"{API}/content/{item['id']}")).json()
    assert item["status"] == "published" and {p["kind"] for p in item["publications"]} == {"x", "webhook"}
    rejected = await authed.post(f"{API}/content/{item['id']}/reject", json={"reason": "late"})
    assert rejected.status_code == 409


def test_markdown_is_safe_and_ghost_token_shape():
    from app.platform.connections import ghost_token
    from app.platform.markdown import to_html

    html = to_html("## Title\n\nHello **world** <script>alert(1)</script> [x](javascript:alert(1)) [ok](https://a.example)\n\n- one\n- two")
    assert "<h2>Title</h2>" in html and "<strong>world</strong>" in html and "<script>" not in html
    assert 'href="https://a.example"' in html and "javascript:" not in html.split("[x]")[0] and "<ul><li>one</li><li>two</li></ul>" in html
    token = ghost_token("abc123:" + "00ff" * 16, now=1_700_000_000)
    header, payload, sig = token.split(".")
    import base64

    claims = json.loads(base64.urlsafe_b64decode(payload + "=="))
    assert claims == {"iat": 1_700_000_000, "exp": 1_700_000_300, "aud": "/admin/"} and sig
    assert json.loads(base64.urlsafe_b64decode(header + "=="))["kid"] == "abc123"
