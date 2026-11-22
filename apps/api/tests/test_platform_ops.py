"""Platform wave 2: memberships/roles/support access, cross-tenant isolation, plans + quotas, catalogue, agent
lifecycle + versions, execution events + SSE, workflow steps v2 (approval, condition, on_error), packages,
public execution API (scopes, idempotency), lead management end to end, model fallback, job recovery."""

from __future__ import annotations

import json
import uuid
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.core.db import session_factory, utcnow
from app.core.security import hash_password
from app.models import AuditLog, ContentItem, ExecutionEvent, Job, Membership, Tenant, User
from app.platform.net import set_fetcher_factory
from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD, CRM_INBOX, WEBHOOK_INBOX, login, make_fetcher

API = "/api/v1"
PUB = "/api/public/v1"
B_EMAIL = "owner@beta.example"


@pytest.fixture(autouse=True)
def _net():
    set_fetcher_factory(make_fetcher)
    WEBHOOK_INBOX.clear()
    CRM_INBOX.clear()
    yield
    set_fetcher_factory(None)


@pytest_asyncio.fixture
async def new_client(tenant):
    from app.main import app

    clients: list[httpx.AsyncClient] = []

    def make() -> httpx.AsyncClient:
        c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
        clients.append(c)
        return c

    yield make
    for c in clients:
        await c.aclose()


async def make_tenant(slug: str = "beta", *, plan: str = "free", email: str = B_EMAIL) -> Tenant:
    async with session_factory()() as db:
        t = Tenant(slug=slug, name=slug.title(), timezone="Asia/Kolkata", settings={}, plan=plan, modules=["pipelines", "datasets"])
        db.add(t)
        await db.flush()
        u = User(tenant_id=t.id, email=email, name="B Owner", role="owner", password_hash=hash_password(ADMIN_PASSWORD))
        db.add(u)
        await db.flush()
        db.add(Membership(user_id=u.id, tenant_id=t.id, role="owner", status="active"))
        await db.commit()
        return t


async def agent(c, name: str, kind: str = "seo_optimizer", config: dict | None = None, **extra) -> dict:
    r = await c.post(f"{API}/agents", json={"name": name, "kind": kind, "config": config or {}, **extra})
    assert r.status_code == 200, r.text
    return r.json()


async def pipeline(c, name: str, steps: list[dict], *, approval: bool = False, trigger: dict | None = None) -> dict:
    r = await c.post(f"{API}/pipelines", json={"name": name, "steps": steps, "trigger": trigger or {"type": "manual"}, "require_approval": approval})
    assert r.status_code == 200, r.text
    return r.json()


ITEM = {"title": "Northwind expands", "url": "https://news.example.com/northwind-warehouses",
        "text": "Northwind Logistics will invest 2.1 billion dollars in 14 automated warehouses across India, the company said on "
                "Tuesday, and expects fulfilment costs to fall 18 percent by 2028 once all sites are running."}


# ---------------------------------------------------------------- isolation, roles, support access
async def test_cross_tenant_isolation(authed, new_client, worker):
    await make_tenant()
    b = await login(new_client(), B_EMAIL)
    b_agent = await agent(b, "B agent")
    b_pipe = await pipeline(b, "B pipe", [{"agent_id": b_agent["id"]}])
    b_run = (await b.post(f"{API}/pipelines/{b_pipe['id']}/run", json={"input": {"items": [ITEM]}})).json()
    b_ds = (await b.post(f"{API}/datasets", json={"name": "B data", "key_field": "name", "fields": [{"key": "name", "label": "Name"}], "public": True})).json()
    b_conn = (await b.post(f"{API}/connections", json={"name": "B hook", "kind": "webhook",
                                                       "config": {"url": "https://client.example.com/x", "secret": "b-secret-123"}})).json()
    async with session_factory()() as db:
        b_content = ContentItem(tenant_id=uuid.UUID(b_agent["id"]) and (await db.execute(select(Tenant.id).where(Tenant.slug == "beta"))).scalar_one(),
                                title="B secret story", slug="b-secret-story", status="published", variants=[{"format": "article", "body": "x"}])
        db.add(b_content)
        await db.commit()
        b_content_id = str(b_content.id)

    a = authed  # owner of "ten", not a platform admin
    for path in (f"/agents/{b_agent['id']}", f"/agents/{b_agent['id']}/events", f"/agents/{b_agent['id']}/executions", f"/runs/{b_run['id']}",
                 f"/runs/{b_run['id']}/events", f"/pipelines/{b_pipe['id']}", f"/content/{b_content_id}", f"/datasets/{b_ds['id']}",
                 f"/datasets/{b_ds['id']}/records", f"/connections/{b_conn['id']}/deliveries"):
        assert (await a.get(API + path)).status_code == 404, path
    assert (await a.patch(f"{API}/connections/{b_conn['id']}", json={"name": "pwned"})).status_code == 404
    assert (await a.post(f"{API}/agents/{b_agent['id']}/run")).status_code == 404
    assert (await a.post(f"{API}/runs/{b_run['id']}/cancel")).status_code == 404
    a.headers["X-Workspace"] = "beta"
    r = await a.get(f"{API}/agents")
    assert r.status_code == 403 and r.json()["error"]["code"] == "workspace_forbidden"
    del a.headers["X-Workspace"]
    assert all(e["run_id"] != b_run["id"] for e in (await a.get(f"{API}/agents/overview")).json()["recent"])

    kr = await a.post(f"{API}/api-keys", json={"name": "A", "scopes": ["runs:write", "runs:read", "datasets:read", "content:read"]})
    assert kr.status_code == 200, kr.text
    key = kr.json()["secret"]
    h = {"Authorization": f"Bearer {key}"}
    assert (await a.get(f"{PUB}/runs/{b_run['id']}", headers=h)).status_code == 404
    assert (await a.post(f"{PUB}/workflows/{b_pipe['id']}/run", headers=h, json={})).status_code == 404
    assert (await a.post(f"{PUB}/agents/{b_agent['id']}/run", headers=h, json={})).status_code == 404
    assert (await a.get(f"{PUB}/datasets/{b_ds['slug']}/records", headers=h)).status_code == 404
    assert (await a.get(f"{PUB}/content/b-secret-story", headers=h)).status_code == 404


async def test_support_access_is_read_only_audited_and_hides_secrets(authed, new_client):
    async with session_factory()() as db:
        await db.execute(update(User).where(User.email == ADMIN_EMAIL).values(is_platform_admin=True))
        await db.commit()
    await make_tenant()
    b = await login(new_client(), B_EMAIL)
    await b.post(f"{API}/connections", json={"name": "Hook", "kind": "webhook", "config": {"url": "https://client.example.com/x", "secret": "very-secret-1"}})
    a_agent = await agent(b, "B agent")
    await pipeline(b, "Hooked", [{"agent_id": a_agent["id"]}], trigger={"type": "webhook"})

    authed.headers["X-Workspace"] = "beta"
    me = (await authed.get(f"{API}/auth/me")).json()
    assert me["support_access"] is True and me["permissions"] == ["view"] and me["tenant"]["slug"] == "beta"
    assert any(w["slug"] == "beta" and w["member"] is False for w in me["workspaces"])
    assert len((await authed.get(f"{API}/agents")).json()["items"]) == 1
    assert (await authed.get(f"{API}/pipelines")).json()["items"][0]["trigger"]["webhook_url"] is None
    conns = (await authed.get(f"{API}/connections")).json()["items"]
    assert "very-secret-1" not in json.dumps(conns)
    r = await authed.post(f"{API}/agents", json={"name": "Nope", "kind": "seo_optimizer"})
    assert r.status_code == 403 and "read-only" in r.json()["error"]["message"]
    async with session_factory()() as db:
        assert (await db.execute(select(AuditLog).where(AuditLog.action == "support_access"))).scalars().first() is not None
    # b's own owner sees the webhook URL
    assert (await b.get(f"{API}/pipelines")).json()["items"][0]["trigger"]["webhook_url"]


async def test_roles_permissions_members_and_last_owner(authed, new_client):
    members = (await authed.get(f"{API}/members")).json()["items"]
    assert {m["role"] for m in members} == {"owner", "operator"}  # legacy owner + reviewer migrated
    invited = {}
    for role in ("viewer", "operator", "developer", "analyst", "admin"):
        r = await authed.post(f"{API}/members", json={"email": f"{role}@ten.example", "role": role})
        assert r.status_code == 200, r.text
        invited[role] = r.json()
        assert invited[role]["temp_password"] and invited[role]["member"]["status"] == "invited"
    assert (await authed.post(f"{API}/members", json={"email": "viewer@ten.example", "role": "viewer"})).status_code == 409

    clients = {}
    for role, res in invited.items():
        c = new_client()
        r = await c.post(f"{API}/auth/login", json={"email": f"{role}@ten.example", "password": res["temp_password"]})
        assert r.status_code == 200
        c.headers["X-CSRF-Token"] = c.cookies.get("lf_csrf")
        clients[role] = c
        me = (await c.get(f"{API}/auth/me")).json()
        assert me["role"] == role
    assert set((await clients["developer"].get(f"{API}/auth/me")).json()["permissions"]) == {"agents.manage", "agents.run", "integrations.manage", "data.edit", "view"}

    async def status(role: str, method: str, path: str, body: dict | None = None) -> int:
        return (await clients[role].request(method, API + path, json=body)).status_code

    assert await status("viewer", "POST", "/agents", {"name": "V", "kind": "seo_optimizer"}) == 403
    assert await status("operator", "POST", "/agents", {"name": "O", "kind": "seo_optimizer"}) == 403
    dev_agent = (await clients["developer"].post(f"{API}/agents", json={"name": "Dev agent", "kind": "seo_optimizer"})).json()
    assert await status("operator", "POST", f"/agents/{dev_agent['id']}/pause") == 200
    assert await status("viewer", "POST", f"/agents/{dev_agent['id']}/resume") == 403
    assert await status("developer", "POST", "/members", {"email": "x@ten.example", "role": "viewer"}) == 403
    assert await status("developer", "POST", "/connections", {"name": "Hook", "kind": "webhook", "config": {"url": "https://c.example.com", "secret": "s"}}) == 200
    assert await status("operator", "POST", "/api-keys", {"name": "K", "scopes": ["content:read"]}) == 403
    assert await status("analyst", "GET", "/usage") == 200 and await status("analyst", "GET", "/audit") == 200
    assert await status("viewer", "GET", "/usage") == 403
    assert await status("analyst", "POST", "/agents", {"name": "A", "kind": "seo_optimizer"}) == 403
    # newsroom routes follow the same permissions
    assert await status("viewer", "POST", "/feed/refresh", {}) == 403
    assert await status("operator", "PATCH", "/settings/tenant", {"name": "Hacked"}) == 403
    assert await status("admin", "PATCH", "/settings/tenant", {"name": "TEN"}) == 200

    owner_member = next(m for m in (await authed.get(f"{API}/members")).json()["items"] if m["role"] == "owner")
    assert (await clients["admin"].patch(f"{API}/members/{owner_member['id']}", json={"role": "viewer"})).status_code == 403
    r = await authed.patch(f"{API}/members/{owner_member['id']}", json={"role": "admin"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "last_owner"
    assert (await authed.delete(f"{API}/members/{owner_member['id']}")).status_code == 409
    viewer_id = invited["viewer"]["member"]["id"]
    assert (await authed.patch(f"{API}/members/{viewer_id}", json={"role": "operator"})).json()["role"] == "operator"
    assert (await authed.delete(f"{API}/members/{viewer_id}")).status_code == 204
    audit = (await authed.get(f"{API}/audit?action=member.")).json()["items"]
    assert {"member.invited", "member.role_changed", "member.removed"} <= {a["action"] for a in audit} and audit[0]["actor"] == ADMIN_EMAIL


async def test_register_creates_workspace_owner(client, monkeypatch):
    from app.core.config import get_settings

    body = {"company": "Acme Coaching", "name": "Asha", "email": "asha@acme.example", "password": "a-long-password", "website": "https://acme.example"}
    assert (await client.post(f"{API}/auth/register", json=body)).json()["error"]["code"] == "signup_disabled"
    monkeypatch.setattr(get_settings(), "allow_signup", True)
    r = await client.post(f"{API}/auth/register", json=body)
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["role"] == "owner" and me["tenant"]["slug"] == "acme-coaching" and me["signup_enabled"] is True
    client.headers["X-CSRF-Token"] = client.cookies.get("lf_csrf")
    usage = (await client.get(f"{API}/usage")).json()
    assert usage["plan"]["key"] == "free" and "not implemented" in usage["billing_note"]
    assert (await client.post(f"{API}/auth/register", json=body)).json()["error"]["code"] == "email_taken"


# ---------------------------------------------------------------- plans, quotas, catalogue
async def test_quotas_and_catalogue_entitlement(authed, new_client, monkeypatch):
    from app.platform import plans

    await make_tenant()
    b = await login(new_client(), B_EMAIL)
    catalog = (await b.get(f"{API}/catalog")).json()["items"]
    assert len(catalog) == 48 and all(c["everyday_use"] for c in catalog) and {"seo_site_auditor", "broken_link_checker", "lead_qualifier", "crm_sync", "support_assistant", "event_finder"} <= {c["key"] for c in catalog}
    pro = next(c for c in catalog if c["key"] == "research_analyst")
    assert pro["entitled"] is False and pro["pricing"]["tier"] == "pro"
    r = await b.post(f"{API}/catalog/research_analyst/activate")
    assert r.status_code == 403 and r.json()["error"]["code"] == "upgrade_required"
    act = (await b.post(f"{API}/catalog/broken_link_checker/activate", json={"name": "Site audit"})).json()
    assert act["source"] == "platform" and act["catalog_key"] == "broken_link_checker" and act["config"]["checks"] == "links" and act["version"] == 1 and "seo.analyze" in act["tools"]
    assert next(c for c in (await b.get(f"{API}/catalog")).json()["items"] if c["key"] == "broken_link_checker")["activated_agent_ids"] == [act["id"]]

    for i in range(4):
        await agent(b, f"Agent {i}")
    r = await b.post(f"{API}/agents", json={"name": "Sixth", "kind": "seo_optimizer"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "quota_exceeded" and r.json()["error"]["details"]["limit"] == 5
    assert (await b.post(f"{API}/packages/lead_management/install")).status_code == 429

    monkeypatch.setitem(plans.PLANS["free"]["limits"], "runs_per_day", 1)
    p = await pipeline(b, "One", [{"agent_id": act["id"]}])
    assert (await b.post(f"{API}/pipelines/{p['id']}/run")).status_code == 200
    r = await b.post(f"{API}/pipelines/{p['id']}/run")
    assert r.status_code == 429 and r.json()["error"]["details"]["metric"] == "runs_per_day"
    usage = (await b.get(f"{API}/usage")).json()
    assert usage["usage"]["agents"] == 5 and usage["usage"]["runs_today"] == 1 and len(usage["by_day"]) == 30

    # Only a platform admin may change plan/status; suspension blocks runs.
    assert (await b.patch(f"{API}/workspaces/beta", json={"plan": "pro"})).status_code == 403
    async with session_factory()() as db:
        await db.execute(update(User).where(User.email == ADMIN_EMAIL).values(is_platform_admin=True))
        await db.commit()
    assert (await authed.patch(f"{API}/workspaces/beta", json={"plan": "pro", "status": "suspended"})).json()["plan"] == "pro"
    r = await b.post(f"{API}/pipelines/{p['id']}/run")
    assert r.status_code == 423 and r.json()["error"]["code"] == "workspace_suspended"
    assert (await b.post(f"{API}/catalog/research_analyst/activate")).status_code == 200  # pro plan now entitled
    plans_list = (await authed.get(f"{API}/plans")).json()["items"]
    assert [p_["key"] for p_ in plans_list] == ["free", "starter", "pro", "business", "enterprise"]
    health = (await authed.get(f"{API}/platform/health")).json()
    assert health["provider"] == "mock" and "queued" in health["queue"]
    assert (await b.get(f"{API}/platform/health")).status_code == 403


# ---------------------------------------------------------------- lifecycle, versions, events, SSE
async def test_agent_lifecycle_versions_events_and_outputs(authed, worker):
    scraper = await agent(authed, "Scraper", "web_scraper", {
        "sources": [{"url": "https://listings.example.com/markets", "type": "html"}], "mode": "css", "item_selector": "div.card",
        "link_selector": "h2 a", "max_items": 1, "max_age_hours": 0})
    writer = await agent(authed, "Writer", "persona_rewriter", {"target_words": 100}, schedule={"every_minutes": 60}, limits={"max_items": 5})
    assert writer["schedule"]["every_minutes"] == 60 and writer["schedule"]["next_run_at"] and writer["limits"]["max_items"] == 5
    p = await pipeline(authed, "Desk", [{"agent_id": scraper["id"]}, {"agent_id": writer["id"], "label": "Write it"}])
    run = (await authed.post(f"{API}/pipelines/{p['id']}/run")).json()
    await worker.drain()
    run = (await authed.get(f"{API}/runs/{run['id']}")).json()
    assert run["status"] == "succeeded", run
    types = [e["type"] for e in (await authed.get(f"{API}/runs/{run['id']}/events")).json()["items"]]
    for t in ("run.queued", "run.started", "step.started", "tool.called", "tool.result", "model.called", "step.finished", "run.finished"):
        assert t in types, (t, types)
    ev = (await authed.get(f"{API}/agents/{scraper['id']}/events")).json()["items"]
    assert any(e["type"] == "tool.called" and e["data"]["tool"] == "web.fetch" for e in ev)
    after = ev[0]["id"]
    assert all(e["id"] > after for e in (await authed.get(f"{API}/agents/{scraper['id']}/events?after={after}")).json()["items"])
    execs = (await authed.get(f"{API}/agents/{writer['id']}/executions")).json()["items"]
    assert execs[0]["status"] == "succeeded" and execs[0]["model_calls"] >= 1 and "content.save" in execs[0]["tools_used"]
    outs = (await authed.get(f"{API}/agents/{writer['id']}/outputs")).json()
    assert outs["items"] and outs["content_ids"]
    overview = (await authed.get(f"{API}/agents/overview")).json()
    assert overview["totals"]["activated"] == 2 and overview["totals"]["executions_7d"] == 2 and overview["totals"]["success_rate_7d"] == 1.0
    assert any(u["agent_id"] == writer["id"] for u in overview["upcoming"])

    v2 = (await authed.patch(f"{API}/agents/{writer['id']}", json={"config": {"target_words": 200}, "version_note": "longer"})).json()
    assert v2["version"] == 2
    versions = (await authed.get(f"{API}/agents/{writer['id']}/versions")).json()["items"]
    assert [v["version"] for v in versions] == [2, 1] and versions[0]["note"] == "longer" and versions[0]["created_by"] == ADMIN_EMAIL
    restored = (await authed.post(f"{API}/agents/{writer['id']}/versions/1/restore")).json()
    assert restored["version"] == 3 and restored["config"]["target_words"] == 100

    # Pausing an agent skips its pipeline step; paused agents cannot be run directly.
    assert (await authed.post(f"{API}/agents/{writer['id']}/pause")).json()["status"] == "paused"
    assert (await authed.post(f"{API}/agents/{writer['id']}/run")).status_code == 409
    run2 = (await authed.post(f"{API}/pipelines/{p['id']}/run")).json()
    await worker.drain()
    run2 = (await authed.get(f"{API}/runs/{run2['id']}")).json()
    assert run2["status"] == "succeeded" and run2["steps"][1]["status"] == "skipped" and "paused" in run2["steps"][1]["logs"][-1]["message"]
    assert (await authed.post(f"{API}/agents/{writer['id']}/resume")).json()["status"] == "active"
    solo = (await authed.post(f"{API}/agents/{writer['id']}/run", json={"input": {"items": [ITEM]}})).json()
    assert solo["pipeline_id"] is None and solo["agent_id"] == writer["id"] and solo["pipeline_name"] == "Writer"
    await worker.drain()
    assert (await authed.get(f"{API}/runs/{solo['id']}")).json()["status"] == "succeeded"


async def test_sse_stream_yields_events_and_resumes(authed):
    from app.platform.events import emit
    from app.platform.routers.ops import stream_events

    async with session_factory()() as db:
        tid = (await db.execute(select(Tenant.id).where(Tenant.slug == "ten"))).scalar_one()
    run_id = uuid.uuid4()
    first = await emit(tid, "run.started", "first", run_id=run_id)
    await emit(tid, "step.log", "token=abc123secret should be hidden https://api.telegram.org/bot123:XYZ/sendMessage", run_id=run_id)

    class FakeRequest:
        def __init__(self, polls: int) -> None:
            self.polls = polls

        async def is_disconnected(self) -> bool:
            self.polls -= 1
            return self.polls < 0

    frames = [f async for f in stream_events(FakeRequest(1), tid, agent_id=None, run_id=run_id, after=0, poll_s=0, heartbeat_s=0)]
    joined = "".join(frames)
    assert frames[0].startswith("retry:") and "event: run.started" in joined and f"id: {first}" in joined
    assert "abc123secret" not in joined and "XYZ" not in joined
    resumed = [f async for f in stream_events(FakeRequest(1), tid, agent_id=None, run_id=run_id, after=first, poll_s=0, heartbeat_s=0)]
    assert "event: run.started" not in "".join(resumed) and "event: step.log" in "".join(resumed)
    idle = [f async for f in stream_events(FakeRequest(2), tid, agent_id=None, run_id=uuid.uuid4(), after=None, poll_s=0, heartbeat_s=0)]
    assert ": heartbeat\n\n" in idle


# ---------------------------------------------------------------- workflows v2
async def test_approval_step_condition_and_on_error(authed, worker):
    seo = await agent(authed, "SEO", "seo_optimizer")
    p = await pipeline(authed, "Gated", [
        {"type": "approval", "label": "Editor sign-off"},
        {"agent_id": seo["id"], "condition": {"field": "items.count", "op": "gt", "value": 5}},
        {"agent_id": seo["id"], "condition": {"field": "title", "op": "contains", "value": "northwind"}, "label": "SEO when relevant"},
    ])
    assert p["steps"][0]["type"] == "approval" and p["version"] == 1
    run = (await authed.post(f"{API}/pipelines/{p['id']}/run", json={"input": {"items": [ITEM]}})).json()
    await worker.drain()
    run = (await authed.get(f"{API}/runs/{run['id']}")).json()
    assert run["status"] == "awaiting_approval" and run["steps"][0]["kind"] == "approval"
    notes = (await authed.get(f"{API}/notifications")).json()
    assert notes["unread"] >= 1 and notes["items"][0]["kind"] == "approval_needed"
    assert (await authed.post(f"{API}/runs/{run['id']}/approve", json={"note": "ok"})).json()["status"] == "awaiting_approval"
    await worker.drain()
    run = (await authed.get(f"{API}/runs/{run['id']}")).json()
    assert run["status"] == "succeeded", run
    assert [s["status"] for s in run["steps"]] == ["succeeded", "skipped", "succeeded"]
    assert (await authed.post(f"{API}/runs/{run['id']}/approve")).status_code == 409

    run2 = (await authed.post(f"{API}/pipelines/{p['id']}/run", json={"input": {"items": [ITEM]}})).json()
    await worker.drain()
    rej = (await authed.post(f"{API}/runs/{run2['id']}/reject", json={"reason": "not today"})).json()
    assert rej["status"] == "cancelled" and rej["error"] == "Rejected: not today"

    # on_error: continue keeps going; stop fails the run (and notifies).
    conn = (await authed.post(f"{API}/connections", json={"name": "CRM", "kind": "rest_api", "config": {"base_url": "https://crm.example.com/api"}})).json()
    action = await agent(authed, "Push", "http_action", {"connections": [conn["id"]], "path": "/leads"})
    assert (await authed.delete(f"{API}/connections/{conn['id']}")).status_code == 204
    p2 = await pipeline(authed, "Tolerant", [{"agent_id": action["id"], "on_error": "retry", "retries": 1}, {"agent_id": seo["id"]}])
    await authed.patch(f"{API}/pipelines/{p2['id']}", json={"steps": [{"agent_id": action["id"], "on_error": "continue"}, {"agent_id": seo["id"]}]})
    versions = (await authed.get(f"{API}/pipelines/{p2['id']}/versions")).json()["items"]
    assert [v["version"] for v in versions] == [2, 1]
    r3 = (await authed.post(f"{API}/pipelines/{p2['id']}/run", json={"input": {"items": [ITEM]}})).json()
    await worker.drain()
    r3 = (await authed.get(f"{API}/runs/{r3['id']}")).json()
    assert r3["status"] == "succeeded" and [s["status"] for s in r3["steps"]] == ["failed", "succeeded"]
    assert "no longer exists" in r3["steps"][0]["error"]
    assert (await authed.get(f"{API}/agents/{action['id']}")).json()["last_error"]

    p3 = await pipeline(authed, "Strict", [{"agent_id": action["id"], "on_error": "retry", "retries": 1}, {"agent_id": seo["id"]}])
    r4 = (await authed.post(f"{API}/pipelines/{p3['id']}/run", json={"input": {"items": [ITEM]}})).json()
    await worker.drain()
    r4 = (await authed.get(f"{API}/runs/{r4['id']}")).json()
    assert r4["status"] == "failed" and r4["steps"][0]["attempts"] == 2 and r4["steps"][1]["status"] == "skipped"
    assert "run.retrying" in [e["type"] for e in (await authed.get(f"{API}/runs/{r4['id']}/events")).json()["items"]]
    assert any(n["kind"] == "run_failed" for n in (await authed.get(f"{API}/notifications")).json()["items"])
    assert (await authed.post(f"{API}/notifications/read-all")).json()["ok"]
    assert (await authed.get(f"{API}/notifications")).json()["unread"] == 0


# ---------------------------------------------------------------- packages + lead management end to end
async def test_lead_management_package_end_to_end(authed, worker):
    packages = {p["key"]: p for p in (await authed.get(f"{API}/packages")).json()["items"]}
    assert {"college_discovery", "executive_editorial", "news_publishing", "seo_automation", "lead_management", "customer_support",
            "hackathon_listings", "ecommerce_price_watch"} <= set(packages)
    assert packages["lead_management"]["required_integrations"] == ["rest_api"] and "crm_sync" in packages["lead_management"]["catalog_agents"]
    first = (await authed.post(f"{API}/packages/lead_management/install")).json()
    assert first["created"] == {"agents": 6, "pipelines": 1, "datasets": 1} and first["skipped"] == []
    again = (await authed.post(f"{API}/packages/lead_management/install")).json()
    assert again["created"] == {"agents": 0, "pipelines": 0, "datasets": 0} and "Lead Qualifier" in again["skipped"] and "Leads" in again["skipped"]
    assert (await authed.get(f"{API}/packages")).json()["items"][[p["key"] for p in packages.values()].index("lead_management")]["installed"]["version"] == "1.0.0"

    agents = {a["name"]: a for a in (await authed.get(f"{API}/agents")).json()["items"]}
    assert agents["CRM Sync"]["source"] == "package" and agents["CRM Sync"]["package_key"] == "lead_management"
    crm = (await authed.post(f"{API}/connections", json={"name": "CRM", "kind": "rest_api",
                                                         "config": {"base_url": "https://crm.example.com/api", "auth_value": "Bearer crm-token-1"}})).json()
    hook = (await authed.post(f"{API}/connections", json={"name": "Team hook", "kind": "webhook",
                                                          "config": {"url": "https://client.example.com/team", "secret": "team-secret"}})).json()
    assert (await authed.post(f"{API}/connections/{crm['id']}/test")).json()["ok"] is True
    cfg = dict(agents["CRM Sync"]["config"])
    await authed.patch(f"{API}/agents/{agents['CRM Sync']['id']}", json={"config": {**cfg, "connections": [crm["id"]]}})
    ncfg = dict(agents["Follow-up Notifier"]["config"])
    await authed.patch(f"{API}/agents/{agents['Follow-up Notifier']['id']}", json={"config": {**ncfg, "connections": [hook["id"]]}})

    pipe = next(p for p in (await authed.get(f"{API}/pipelines")).json()["items"] if p["name"] == "Lead intake")
    path = pipe["trigger"]["webhook_url"].split("http://testserver", 1)[1]
    leads = {"items": [
        {"title": "Riya", "data": {"email": "riya@example.com", "name": "Riya", "course": "MBA (weekend)", "city": "Pune", "message": "Fees?"}},
        {"title": "Riya again", "data": {"email": "riya@example.com", "name": "Riya", "course": "MBA", "city": "Pune"}},
        {"title": "Bad", "data": {"email": "not-an-email", "name": "Bad"}},
        {"title": "Kabir", "data": {"email": "kabir@example.com", "name": "Kabir", "course": "Data Science", "city": "Mumbai"}},
    ]}
    run_id = (await authed.post(path, json=leads)).json()["run_id"]
    await worker.drain()
    run = (await authed.get(f"{API}/runs/{run_id}")).json()
    assert run["status"] == "succeeded", run["steps"]
    assert [s["status"] for s in run["steps"]] == ["succeeded"] * 6 and run["items_out"] == 2
    ds = next(d for d in (await authed.get(f"{API}/datasets")).json()["items"] if d["slug"] == "leads")
    recs = {r["key"]: r["data"] for r in (await authed.get(f"{API}/datasets/{ds['id']}/records")).json()["items"]}
    assert set(recs) == {"riya@example.com", "kabir@example.com"}
    assert recs["riya@example.com"]["assigned_to"] == "MBA admissions desk" and recs["kabir@example.com"]["assigned_to"] == "Tech courses desk"
    assert len(CRM_INBOX) == 2 and CRM_INBOX[0].headers["authorization"] == "Bearer crm-token-1"
    sent = json.loads(CRM_INBOX[0].content)
    assert sent["email"] == "riya@example.com" and sent["owner"] == "MBA admissions desk"
    assert len([r for r in WEBHOOK_INBOX if r.headers.get("x-layerflow-event") == "message"]) == 2
    deliveries = (await authed.get(f"{API}/connections/{crm['id']}/deliveries")).json()["items"]
    assert len([d for d in deliveries if d["event"] == "http.post"]) == 2 and all(d["ok"] for d in deliveries)
    tool_events = [e for e in (await authed.get(f"{API}/runs/{run_id}/events")).json()["items"] if e["type"] == "tool.called"]
    assert {"http.request", "notify.send", "dataset.upsert", "model.generate"} & {e["data"]["tool"] for e in tool_events} >= {"http.request", "notify.send", "dataset.upsert"}
    assert "crm-token-1" not in json.dumps((await authed.get(f"{API}/runs/{run_id}/events")).json())
    audit = (await authed.get(f"{API}/audit?action=tool.")).json()["items"]
    assert {"tool.http.request", "tool.notify.send"} <= {a["action"] for a in audit}


async def test_http_action_allowlist_and_side_effect_approval(authed, worker):
    crm = (await authed.post(f"{API}/connections", json={"name": "CRM", "kind": "rest_api", "config": {"base_url": "https://crm.example.com/api"}})).json()
    escape = await agent(authed, "Escape", "http_action", {"connections": [crm["id"]], "path": "https://evil.example.org/steal"})
    r = (await authed.post(f"{API}/agents/{escape['id']}/run", json={"input": {"items": [ITEM]}})).json()
    await worker.drain()
    r = (await authed.get(f"{API}/runs/{r['id']}")).json()
    assert r["status"] == "failed" and "not allowed" in r["error"] and not CRM_INBOX

    gated = await agent(authed, "Gated push", "http_action", {"connections": [crm["id"]], "path": "/leads"}, requires_approval=True)
    r = (await authed.post(f"{API}/agents/{gated['id']}/run", json={"input": {"items": [ITEM]}})).json()
    await worker.drain()
    assert (await authed.get(f"{API}/runs/{r['id']}")).json()["status"] == "awaiting_approval" and not CRM_INBOX
    await authed.post(f"{API}/runs/{r['id']}/approve")
    await worker.drain()
    assert (await authed.get(f"{API}/runs/{r['id']}")).json()["status"] == "succeeded" and len(CRM_INBOX) == 1


# ---------------------------------------------------------------- public execution API
async def test_public_run_api_scopes_and_idempotency(authed, worker):
    seo = await agent(authed, "SEO", "seo_optimizer")
    p = await pipeline(authed, "Public flow", [{"agent_id": seo["id"]}])
    write = (await authed.post(f"{API}/api-keys", json={"name": "Writer", "scopes": ["runs:write"]})).json()["secret"]
    read = (await authed.post(f"{API}/api-keys", json={"name": "Reader", "scopes": ["runs:read"]})).json()["secret"]
    hw = {"Authorization": f"Bearer {write}", "Idempotency-Key": "order-42"}
    first = await authed.post(f"{PUB}/workflows/{p['id']}/run", headers=hw, json={"input": {"items": [ITEM]}})
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["status"] == "queued" and body["workflow"] == {"id": p["id"], "name": "Public flow"} and body["output"] is None
    again = (await authed.post(f"{PUB}/workflows/{p['id']}/run", headers=hw, json={"input": {"items": [ITEM]}})).json()
    assert again["id"] == body["id"]
    assert (await authed.get(f"{PUB}/runs/{body['id']}", headers={"Authorization": f"Bearer {write}"})).json()["error"]["code"] == "insufficient_scope"
    assert (await authed.post(f"{PUB}/workflows/{p['id']}/run", headers={"X-API-Key": read})).status_code == 403
    await worker.drain()
    done = (await authed.get(f"{PUB}/runs/{body['id']}", headers={"X-API-Key": read})).json()
    assert done["status"] == "succeeded" and done["output"]["items"][0]["title"] == "Northwind expands" and done["steps"][0]["name"] == "SEO"
    solo = (await authed.post(f"{PUB}/agents/{seo['id']}/run", headers={"Authorization": f"Bearer {write}"},
                              json={"input": {"data": {"title": "Form", "email": "x@y.z"}}})).json()
    assert solo["agent"] == {"id": seo["id"], "name": "SEO"} and solo["workflow"] is None
    runs = (await authed.get(f"{API}/runs")).json()["items"]
    assert {r["trigger"] for r in runs} == {"api"}
    assert (await authed.get(f"{API}/usage")).json()["usage"]["api_calls_today"] >= 4
    assert any(a["actor"].startswith("api_key:lf_pk_") for a in (await authed.get(f"{API}/audit?action=run.started")).json()["items"])


async def test_public_api_daily_quota(authed, monkeypatch):
    from app.platform import plans

    key = (await authed.post(f"{API}/api-keys", json={"name": "K", "scopes": ["content:read"]})).json()["secret"]
    async with session_factory()() as db:
        await db.execute(update(Tenant).where(Tenant.slug == "ten").values(plan="free"))
        await db.commit()
    monkeypatch.setitem(plans.PLANS["free"]["limits"], "api_calls_per_day", 2)
    h = {"X-API-Key": key}
    assert (await authed.get(f"{PUB}/content", headers=h)).status_code == 200
    assert (await authed.get(f"{PUB}/content", headers=h)).status_code == 200
    r = await authed.get(f"{PUB}/content", headers=h)
    assert r.status_code == 429 and r.json()["error"]["code"] == "quota_exceeded"


# ---------------------------------------------------------------- tools, model gateway, recovery
async def test_tools_registry_and_new_kinds_inline(authed):
    tools = {t["key"]: t for t in (await authed.get(f"{API}/tools")).json()["items"]}
    assert {"web.fetch", "web.search", "rss.read", "sitemap.read", "html.extract", "ai.extract", "seo.analyze", "dataset.read",
            "dataset.upsert", "content.save", "publish.connection", "http.request", "notify.send", "image.discover", "model.generate",
            "links.collect", "doc.read", "image.search", "image.hash", "suggest.keywords"} == set(tools)
    assert tools["http.request"]["side_effects"] is True and tools["web.fetch"]["side_effects"] is False

    checker = await agent(authed, "Checker", "fact_checker")
    res = (await authed.post(f"{API}/agents/{checker['id']}/test", json={"input": {"items": [{
        **ITEM, "formats": {"article": "Northwind will invest 2.1 billion dollars in 14 warehouses. Profits will triple to 900 million dollars."}}]}})).json()
    fc = res["items"][0]["data"]["fact_check"]
    assert res["ok"] and fc["verified"] >= 1 and fc["unsupported"] >= 1 and "unsupported_claims" in res["items"][0]["flags"]

    auditor = await agent(authed, "Auditor", "site_auditor", {"site_url": "https://theexecutivenarrative.com", "max_pages": 5})
    res = (await authed.post(f"{API}/agents/{auditor['id']}/test", json={})).json()
    assert res["ok"], res
    findings = {f["id"] for f in res["items"][0]["data"]["findings"]}
    assert {"missing_meta", "missing_canonical", "missing_h1"} <= findings and res["items"][0]["formats"]["article"].startswith("# SEO audit")

    images = await agent(authed, "Images", "image_finder", {"min_width": 0})
    res = (await authed.post(f"{API}/agents/{images['id']}/test", json={"input": {"items": [ITEM]}})).json()
    assert res["ok"]

    ds = (await authed.post(f"{API}/datasets", json={"name": "Prices", "key_field": "name", "fields": [
        {"key": "name", "label": "Name"}, {"key": "price", "label": "Price", "type": "currency"}]})).json()
    await authed.post(f"{API}/datasets/{ds['id']}/import", json={"rows": [{"name": "Kettle", "price": 999}, {"name": "Toaster", "price": 1500}]})
    detector = await agent(authed, "Detector", "change_detector", {"dataset": ds["id"]})
    res = (await authed.post(f"{API}/agents/{detector['id']}/test", json={"input": {"items": [
        {"title": "Kettle", "data": {"name": "Kettle", "price": 899}}, {"title": "Toaster", "data": {"name": "Toaster", "price": 1500}},
        {"title": "Mixer", "data": {"name": "Mixer", "price": 2500}}]}})).json()
    status = {i["title"]: i["data"]["change"] for i in res["items"]}
    assert set(status) == {"Kettle", "Mixer"} and status["Kettle"]["diff"] == {"price": {"old": 999, "new": 899}} and status["Mixer"]["status"] == "new"

    report = await agent(authed, "Report", "report_builder")
    res = (await authed.post(f"{API}/agents/{report['id']}/test", json={"input": {"items": [ITEM]}})).json()
    assert res["ok"] and res["items"][0]["formats"]["article"].startswith("# Report")

    researcher = await agent(authed, "Researcher", "researcher", {"question": "northwind warehouses", "search": "none", "max_sources": 2, "sources": [
        {"url": "https://news.example.com/northwind-warehouses", "type": "html"}, {"url": "https://wire.example.org/northwind-analysis", "type": "html"}]})
    res = (await authed.post(f"{API}/agents/{researcher['id']}/test", json={})).json()
    assert res["ok"], res
    brief = res["items"][0]
    assert brief["data"]["evidence"]["key_facts"] and "## Sources" in brief["formats"]["article"]


async def test_model_fallback_to_fast(authed):
    from app.core.config import get_settings
    from app.providers.base import ModelUnavailable
    from app.providers.mock import MockProvider
    from app.providers.registry import get_provider, set_provider

    class WriterDown(MockProvider):
        async def generate(self, **kw):
            if kw["model"] == get_settings().model_writer:
                raise ModelUnavailable("writer offline")
            return await super().generate(**kw)

    old = get_provider()
    set_provider(WriterDown())
    try:
        w = await agent(authed, "Writer", "persona_rewriter", {"target_words": 80})
        res = (await authed.post(f"{API}/agents/{w['id']}/test", json={"input": {"items": [ITEM]}})).json()
        assert res["ok"] and res["model"] == get_settings().model_fast
        await authed.patch(f"{API}/agents/{w['id']}", json={"limits": {"allow_model_fallback": False}})
        res = (await authed.post(f"{API}/agents/{w['id']}/test", json={"input": {"items": [ITEM]}})).json()
        assert not res["ok"] or "persona_rewriter_failed" in res["items"][0]["flags"]
    finally:
        set_provider(old)


async def test_runs_survive_worker_restart(authed, worker):
    from app.queue import jobs as q

    seo = await agent(authed, "SEO", "seo_optimizer")
    p = await pipeline(authed, "Resilient", [{"agent_id": seo["id"]}])
    run = (await authed.post(f"{API}/pipelines/{p['id']}/run", json={"input": {"items": [ITEM]}})).json()
    async with session_factory()() as db:
        job = await q.claim(db, "crashed-worker", q.JOB_TYPES)
        assert job is not None and job.type == "pipeline_run"
        await db.execute(update(Job).where(Job.id == job.id).values(locked_at=utcnow() - timedelta(hours=1)))
        await db.commit()
        stale = await q.requeue_stale(db, visibility_timeout_s=60)
        assert [j.id for j in stale] == [job.id] and stale[0].status == "queued"
    await worker.drain()
    assert (await authed.get(f"{API}/runs/{run['id']}")).json()["status"] == "succeeded"
    async with session_factory()() as db:
        assert (await db.execute(select(ExecutionEvent).where(ExecutionEvent.type == "run.finished"))).scalars().first() is not None
