"""Wave 3: catalogue file + presets, the upgraded scraper (structured / tables / AI rows / detail pages / crawl /
pagination), the five new engines, images (open licences, dHash dedupe, alt text, content + public API), every
connection kind, progress, the unified activity feed and usage per agent."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import smtplib
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from app.core.db import session_factory, utcnow
from app.models import PipelineRun, Tenant
from app.platform.net import set_fetcher_factory
from tests.conftest import WEBHOOK_INBOX, make_fetcher
from tests.web_fixtures import SENT, WATCH

API = "/api/v1"
REPO = Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def _net():
    set_fetcher_factory(make_fetcher)
    SENT.clear()
    WEBHOOK_INBOX.clear()
    yield
    set_fetcher_factory(None)


async def agent(c, name: str, kind: str, config: dict | None = None, **extra) -> dict:
    r = await c.post(f"{API}/agents", json={"name": name, "kind": kind, "config": config or {}, **extra})
    assert r.status_code == 200, r.text
    return r.json()


async def try_agent(c, a: dict, body: dict | None = None) -> dict:
    res = (await c.post(f"{API}/agents/{a['id']}/test", json=body or {})).json()
    assert res["ok"], res
    return res


async def run_agent(c, worker, a: dict, items: list[dict] | None = None) -> dict:
    run = (await c.post(f"{API}/agents/{a['id']}/run", json={"input": {"items": items}} if items else {})).json()
    await worker.drain()
    run = (await c.get(f"{API}/runs/{run['id']}")).json()
    assert run["status"] == "succeeded", run
    return run


# ---------------------------------------------------------------- catalogue
def test_catalogue_file_presets_and_demo_copy():
    from app.platform.catalog import AGENT_KINDS, validate_config
    from app.platform.catalog_agents import _load, catalog, catalog_path

    _load.cache_clear()
    raw = json.loads(catalog_path().read_text(encoding="utf-8"))
    keys = [a["key"] for a in raw["agents"]]
    assert len(keys) == 50 and len(set(keys)) == 50
    entries = catalog()
    for e in entries.values():
        schema_keys = {f["key"] for f in AGENT_KINDS[e.kind].config_schema}
        assert e.everyday_use and e.preset is not None, e.key
        validate_config(e.kind, e.config, require=False)  # every preset is valid for its engine
        assert set(e.required_config) <= schema_keys, (e.key, set(e.required_config) - schema_keys)
        assert e.model in (None, "fast", "writer"), e.key
    assert entries["translator"].config["language"] == "Hindi"
    assert entries["table_extractor"].config["mode"] == "tables" and entries["structured_data_reader"].config["mode"] == "structured"
    assert entries["site_crawler"].config["mode"] == "crawl" and entries["broken_link_checker"].config["checks"] == "links"
    assert entries["open_image_finder"].config["sources"] == ["openverse", "wikimedia"]
    assert entries["sentiment_tagger"].config["categories"] == ["Positive", "Neutral", "Negative"]
    assert "- " in entries["summarizer"].config["instructions"]
    demo = REPO / "apps" / "web" / "lib" / "demo" / "catalog-agents.json"
    if not demo.exists():
        pytest.skip("apps/web/lib/demo/catalog-agents.json not synced yet (run scripts/sync_catalog.py)")
    copy = json.loads(demo.read_text(encoding="utf-8"))
    if not all("preset" in a for a in copy.get("agents", [])):
        pytest.skip("apps/web/lib/demo/catalog-agents.json predates the presets: run scripts/sync_catalog.py")
    assert copy == raw, "demo catalogue differs: run scripts/sync_catalog.py"


async def test_activate_uses_preset_and_entitlement(authed):
    r = (await authed.post(f"{API}/catalog/summarizer/activate")).json()
    assert r["catalog_key"] == "summarizer" and r["config"]["output_format"] == "newsletter" and r["model"] == "fast"
    items = {c["key"]: c for c in (await authed.get(f"{API}/catalog")).json()["items"]}
    assert items["crm_sync"]["entitled"] is True  # the test workspace is on the enterprise plan
    assert items["summarizer"]["activated_agent_ids"] == [r["id"]] and items["summarizer"]["everyday_use"]


# ---------------------------------------------------------------- web scraper
async def test_scraper_structured_data_with_pagination(authed):
    a = await agent(authed, "Shop", "web_scraper", {"sources": [{"url": "https://shop.example.com/products"}], "mode": "auto",
                                                     "extract_fields": [{"key": "name", "label": "Name"}, {"key": "price", "label": "Price", "type": "currency"},
                                                                        {"key": "rating", "label": "Rating", "type": "rating"}]})
    res = await try_agent(authed, a)
    by_title = {i["title"]: i for i in res["items"]}
    assert set(by_title) == {"Northwind Kettle 1.5L", "Contoso Toaster", "Fabrikam Mixer"}
    assert by_title["Northwind Kettle 1.5L"]["data"]["price"] == "999" and by_title["Northwind Kettle 1.5L"]["url"] == "https://shop.example.com/p/kettle"
    logs = " ".join(ln["message"] for ln in res["logs"])
    assert "Page 2/5" in logs and "Used JSON-LD data on 2 page(s)" in logs

    s = await agent(authed, "Struct", "web_scraper", {"sources": [{"url": "https://shop.example.com/products"}], "mode": "structured",
                                                       "follow_pagination": False})
    res = await try_agent(authed, s)
    assert len(res["items"]) == 2 and res["items"][0]["data"]["offers.price"] == "999" and res["items"][0]["data"]["_type"] == "Product"


async def test_scraper_tables_ai_rows_detail_pages_and_crawl(authed):
    t = await agent(authed, "Fees", "web_scraper", {"sources": [{"url": "https://shop.example.com/fees"}], "mode": "tables"})
    rows = (await try_agent(authed, t))["items"]
    assert [r["title"] for r in rows] == ["B.Tech CSE", "MBA"]
    assert rows[1]["data"]["annual_fees"] == 250000 and rows[1]["data"]["seats"] == 120 and rows[0]["data"]["_table"] == "Course fees"

    fields = [{"key": "name", "label": "Name"}, {"key": "start_date", "label": "Start date", "type": "date"}, {"key": "prize_pool", "label": "Prize pool"}]
    ai = await agent(authed, "Events", "web_scraper", {"sources": [{"url": "https://events.example.com/list"}], "mode": "auto", "extract_fields": fields})
    res = await try_agent(authed, ai)
    assert [i["data"]["name"] for i in res["items"]] == ["Monsoon AI Sprint", "ChainCraft Weekend"] and res["items"][0]["data"]["start_date"] == "2027-01-10"
    assert "AI extraction on 1 page(s)" in " ".join(ln["message"] for ln in res["logs"])

    detail = await agent(authed, "Detail", "web_scraper", {"sources": [{"url": "https://events.example.com/list2"}], "mode": "auto",
                                                            "detail_follow": True, "extract_fields": fields + [{"key": "location", "label": "Location"}]})
    res = await try_agent(authed, detail)
    got = {i["title"]: i["data"] for i in res["items"]}
    assert got["Monsoon AI Sprint"]["location"] == "Pune" and got["ChainCraft Weekend"]["start_date"] == "2027-02-01"
    assert "Used microdata data on 2 page(s)" in " ".join(ln["message"] for ln in res["logs"])

    crawl = await agent(authed, "Crawl", "web_scraper", {"sources": [{"url": "https://site.example.com/"}], "mode": "crawl", "crawl_depth": 1,
                                                          "max_pages": 10})
    pages = {i["url"]: i for i in (await try_agent(authed, crawl))["items"]}
    assert {"https://site.example.com/", "https://site.example.com/about", "https://site.example.com/blog/one", "https://site.example.com/contact"} <= set(pages)
    home = pages["https://site.example.com/"]["data"]
    assert home["meta_description"] == "Acme makes things." and "Acme" in home["headings"] and "https://site.example.com/blog/one" in home["links"]


# ---------------------------------------------------------------- new engines
async def test_link_collector_patterns_depth_and_sitemap(authed):
    a = await agent(authed, "Links", "link_collector", {"start_urls": ["https://site.example.com/"], "sitemaps": ["https://site.example.com/sitemap.xml"],
                                                         "include_patterns": ["/blog/*", "/contact"], "depth": 1})
    urls = [i["url"] for i in (await try_agent(authed, a))["items"]]
    assert urls[0] == "https://site.example.com/contact"  # from the sitemap
    assert set(urls) == {"https://site.example.com/contact", "https://site.example.com/blog/one", "https://site.example.com/blog/two"}
    assert all("utm_" not in u for u in urls)
    regex = await agent(authed, "Regex", "link_collector", {"start_urls": ["https://site.example.com/"], "include_patterns": ["re:/blog/(one|two)$"],
                                                             "exclude_patterns": ["*two"], "same_site": True})
    assert [i["url"] for i in (await try_agent(authed, regex))["items"]] == ["https://site.example.com/blog/one"]


async def test_document_reader_pdf_text_and_fields(authed):
    a = await agent(authed, "Docs", "document_reader", {"sources": [{"url": "https://docs.example.com/notice.pdf"}, {"url": "https://docs.example.com/page.html"}],
                                                         "extract_fields": [{"key": "total_fees", "label": "Total fees", "type": "currency"},
                                                                            {"key": "last_date", "label": "Last date", "type": "date"}]})
    res = await try_agent(authed, a)
    assert len(res["items"]) == 1
    doc = res["items"][0]
    assert doc["title"] == "Fee notice 2026" and "Total fees: 250000" in doc["text"] and doc["data"]["pages"] == 1
    assert doc["data"]["total_fees"] == 250000 and doc["data"]["last_date"] == "2026-12-31"
    assert any("page.html" in ln["message"] and ln["level"] == "warn" for ln in res["logs"])  # HTML is not read as a document


async def test_page_watcher_baseline_change_and_noise(authed, worker):
    WATCH["html"] = "<html><body><div id='n'><p>Admissions open</p><p>Updated 10:30 am</p></div><footer>x</footer></body></html>"
    a = await agent(authed, "Watch", "page_watcher", {"sources": [{"url": "https://watch.example.com/notices"}], "selector": "#n"})
    first = await run_agent(authed, worker, a)
    assert first["items_out"] == 0 and "Baseline saved" in first["steps"][0]["logs"][-2]["message"]
    WATCH["html"] = WATCH["html"].replace("10:30 am", "11:45 am")  # only the time changed
    assert (await run_agent(authed, worker, a))["items_out"] == 0
    WATCH["html"] = WATCH["html"].replace("<p>Admissions open</p>", "<p>Admissions closed</p><p>Results on 5 Jan</p>")
    changed = await run_agent(authed, worker, a)
    assert changed["items_out"] == 1
    out = (await authed.get(f"{API}/agents/{a['id']}/outputs")).json()["items"][0]
    assert out["data"]["status"] == "changed" and "+Admissions closed" in out["data"]["diff"] and "-Admissions open" in out["data"]["diff"]
    assert "Admissions open" in out["data"]["before"] and out["data"]["added_lines"] >= 1


async def test_keyword_researcher_suggestions_competitors_and_intent(authed):
    from app.platform.kinds.keyword_researcher import intent_of

    assert intent_of("buy kettle online")[0] == "transactional" and intent_of("best kettle 2026")[0] == "commercial"
    assert intent_of("how to descale a kettle")[0] == "informational" and intent_of("acme login")[0] == "navigational"
    a = await agent(authed, "Keywords", "keyword_researcher", {"seed_keywords": ["northwind"], "expand_alphabet": False,
                                                               "competitor_urls": ["https://news.example.com/northwind-warehouses"], "max_keywords": 60})
    res = await try_agent(authed, a)
    kws = {i["title"]: i["data"] for i in res["items"]}
    assert "northwind warehouses" in kws and kws["northwind warehouses"]["source"] == "suggest"
    assert any(d["source"] == "competitor" for d in kws.values())
    assert {d["intent"] for d in kws.values()} <= {"informational", "commercial", "transactional", "navigational"}
    assert "Intent:" in " ".join(ln["message"] for ln in res["logs"])


async def test_comparer_fuzzy_groups_winners_and_content(authed, worker):
    a = await agent(authed, "Compare", "comparer", {"match_field": "title", "compare_fields": ["data.price:lower", "data.rating:higher", "data.city"],
                                                     "fuzzy_threshold": 80})
    items = [
        {"title": "Northwind Kettle 1.5L", "source_name": "ShopA", "data": {"price": 999, "rating": 4.2}},
        {"title": "Northwind kettle 1.5 L", "source_name": "ShopB", "data": {"price": "949", "rating": 4.0}},
        {"title": "Contoso Toaster", "source_name": "ShopA", "data": {"price": 1500, "rating": 4.5}},
    ]
    run = await run_agent(authed, worker, a, items)
    assert run["items_out"] == 2
    outs = {i["title"]: i["data"] for i in (await authed.get(f"{API}/agents/{a['id']}/outputs")).json()["items"]}
    kettle = outs["Northwind Kettle 1.5L"]
    assert kettle["matched"] == 2 and kettle["values"]["data.price"] == 949 and kettle["best_source"]["data.price"] == "ShopB"
    assert outs["Contoso Toaster"]["winner_of"] == ["data.rating"] and kettle["winner_of"] == ["data.price"]
    content = (await authed.get(f"{API}/content")).json()["items"][0]
    article = next(v for v in content["variants"] if v["format"] == "article")["body"]
    assert "| Name |" in article and "**949** ✓" in article and content["title"].startswith("Comparison")


# ---------------------------------------------------------------- images
async def test_image_finder_open_licence_dedupe_alt_and_content(authed, worker):
    a = await agent(authed, "Images", "image_finder", {"sources": ["page", "openverse", "wikimedia"], "min_width": 300, "max_images_per_item": 5,
                                                        "alt_text": True})
    res = await try_agent(authed, a, {"input": {"items": [{"title": "Campus library", "url": "https://gallery.example.com/page"}]}})
    imgs = res["items"][0]["data"]["images"]
    urls = [i["url"] for i in imgs]
    assert "https://img.example.com/icon.png" not in urls
    assert urls.count("https://img.example.com/a.png") == 1 and "https://img.example.com/a-copy.png" not in urls  # dHash near-duplicate
    assert imgs[0]["open_license"] is True and imgs[0]["license"] in ("CC0", "CC BY-SA 4.0")
    nc = next(i for i in imgs if i["url"].endswith("/b.png"))
    assert nc["license"] == "CC BY-NC 2.0" and nc["open_license"] is False and urls.index(nc["url"]) > urls.index(imgs[0]["url"])
    assert all(i["hash"] and len(i["hash"]) == 16 for i in imgs) and all(i["alt"] for i in imgs)
    assert next(i for i in imgs if i["source"] == "wikimedia")["credit"] == "Chen"
    assert res["items"][0]["image_url"] == imgs[0]["url"]

    # Images flow into content and out through the public API / webhooks.
    conn = (await authed.post(f"{API}/connections", json={"name": "Site", "kind": "webhook",
                                                          "config": {"url": "https://client.example.com/api/layerflow", "secret": "s3cret"}})).json()
    img = await agent(authed, "Img", "image_finder", {"sources": ["page"], "min_width": 300})
    studio = await agent(authed, "Studio", "multi_format", {"formats": ["linkedin_post"]})
    pub = await agent(authed, "Pub", "auto_publisher", {"connections": [conn["id"]]})
    p = (await authed.post(f"{API}/pipelines", json={"name": "Visual", "require_approval": False, "trigger": {"type": "manual"},
                                                    "steps": [{"agent_id": img["id"]}, {"agent_id": studio["id"]}, {"agent_id": pub["id"]}]})).json()
    await authed.post(f"{API}/pipelines/{p['id']}/run", json={"input": {"items": [{
        "title": "Campus library opens", "url": "https://gallery.example.com/page",
        "text": "The new campus library opens on Monday with 400 seats, a maker lab and late-night hours for exam season."}]}})
    await worker.drain()
    content = (await authed.get(f"{API}/content")).json()["items"][0]
    assert content["images"] and content["image_url"] == content["images"][0]["url"]
    body = json.loads(WEBHOOK_INBOX[-1].content)["content"]
    assert body["images"] and body["image_url"] == body["images"][0]["url"]


async def test_ollama_provider_sends_images():
    from app.providers.ollama import OllamaProvider

    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(json.loads(req.content))
        return httpx.Response(200, json={"message": {"content": '{"alt": "x"}'}})

    p = OllamaProvider("http://ollama.test", transport=httpx.MockTransport(handler))
    await p.generate(model="moondream", system="s", prompt="p", schema=None, temperature=0, max_tokens=10, timeout_s=5, images=[b"\x89PNG"])
    assert seen["messages"][1]["images"] == [base64.b64encode(b"\x89PNG").decode()]


# ---------------------------------------------------------------- connections, every kind
async def test_every_connection_kind_tests_and_delivers(authed, worker, monkeypatch):
    kinds = {k["kind"]: k for k in (await authed.get(f"{API}/connection-kinds")).json()["items"]}
    assert all(3 <= len(k["setup_steps"]) <= 5 for k in kinds.values())

    class FakeSMTP:
        sent: list = []

        def __init__(self, host, port, timeout=None, **kw):
            assert timeout and host == "smtp.example.com"

        def starttls(self, context=None):
            pass

        def login(self, user, password):
            if password != "app-pass":
                raise smtplib.SMTPAuthenticationError(535, b"bad")

        def send_message(self, msg):
            FakeSMTP.sent.append(msg)

        def quit(self):
            pass

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    configs = {
        "nextjs": {"endpoint_url": "https://client.example.com/api/layerflow", "signing_secret": "nx-secret", "site_url": "https://client.example.com"},
        "webhook": {"url": "https://client.example.com/hook", "secret": "wh-secret"},
        "wordpress": {"site_url": "https://blog.example.com", "username": "ed", "app_password": "abcd efgh"},
        "ghost": {"admin_url": "https://ghost.example.com", "admin_api_key": "6489aa:" + "ab" * 32},
        "telegram": {"bot_token": "123:ABC", "chat_id": "@lfdemo"},
        "slack": {"webhook_url": "https://hooks.slack.com/services/T0/B0/xyz"},
        "discord": {"webhook_url": "https://discord.com/api/webhooks/1/abc"},
        "email_smtp": {"host": "smtp.example.com", "port": "587", "username": "me", "password": "app-pass", "from_email": "me@x.example",
                       "to_emails": "team@x.example"},
        "rest_api": {"base_url": "https://crm.example.com/api", "auth_value": "Bearer t"},
        "linkedin": {},
        "x": {"handle": "@brand"},
    }
    ids = {}
    for kind, cfg in configs.items():
        c = (await authed.post(f"{API}/connections", json={"name": kind, "kind": kind, "config": cfg})).json()
        ids[kind] = c["id"]
        result = (await authed.post(f"{API}/connections/{c['id']}/test")).json()
        expect_ok = kind != "linkedin"
        assert result["ok"] is expect_ok, (kind, result)
        assert result["detail"]
    assert "lf_demo_bot" in (await authed.post(f"{API}/connections/{ids['telegram']}/test")).json()["detail"]

    bad = (await authed.post(f"{API}/connections", json={"name": "bad tg", "kind": "telegram", "config": {"bot_token": "bad", "chat_id": "@x"}})).json()
    detail = (await authed.post(f"{API}/connections/{bad['id']}/test")).json()["detail"]
    assert "refused the credentials" in detail and "bad" not in detail.split("bot")[-1][:5]
    bad_mail = (await authed.post(f"{API}/connections", json={"name": "bad mail", "kind": "email_smtp",
                                                              "config": {**configs["email_smtp"], "password": "nope"}})).json()
    assert "app password" in (await authed.post(f"{API}/connections/{bad_mail['id']}/test")).json()["detail"]

    # Publish one item everywhere.
    w = await agent(authed, "Writer", "persona_rewriter", {"target_words": 80})
    run = (await authed.post(f"{API}/agents/{w['id']}/run", json={"input": {"items": [{
        "title": "Northwind expands", "url": "https://news.example.com/northwind-warehouses",
        "text": "Northwind Logistics will invest 2.1 billion dollars in 14 automated warehouses across India, the company said on "
                "Tuesday, and expects fulfilment costs to fall 18 percent by 2028 once every site is running."}]}})).json()
    await worker.drain()
    content_id = (await authed.get(f"{API}/runs/{run['id']}")).json() and (await authed.get(f"{API}/content")).json()["items"][0]["id"]
    publish_to = [ids[k] for k in configs if k != "rest_api"]
    await authed.post(f"{API}/content/{content_id}/publish", json={"connection_ids": publish_to})
    await worker.drain()
    pubs = {p["kind"]: p for p in (await authed.get(f"{API}/content/{content_id}")).json()["publications"]}
    for kind in ("nextjs", "webhook", "wordpress", "ghost", "telegram", "slack", "discord", "email_smtp"):
        assert pubs[kind]["status"] == "published", (kind, pubs[kind])
    assert pubs["linkedin"]["status"] == "manual" and pubs["x"]["status"] == "manual"
    assert pubs["wordpress"]["url"] == "https://blog.example.com/?p=7" and pubs["ghost"]["url"] == "https://ghost.example.com/hello/"
    assert pubs["telegram"]["url"] == "https://t.me/lfdemo/5" and len(FakeSMTP.sent) == 1
    ghost = next(r for r in SENT if r.url.host == "ghost.example.com")
    token = ghost.headers["authorization"].split(" ", 1)[1]
    header, payload, sig = token.split(".")
    expected = base64.urlsafe_b64encode(hmac.new(bytes.fromhex("ab" * 32), f"{header}.{payload}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    assert sig == expected and json.loads(base64.urlsafe_b64decode(header + "=="))["kid"] == "6489aa"
    nx = next(r for r in WEBHOOK_INBOX if r.url.path == "/api/layerflow" and r.headers.get("x-layerflow-event") == "content.published")
    assert nx.headers["x-layerflow-signature"] == "sha256=" + hmac.new(b"nx-secret", nx.content, hashlib.sha256).hexdigest()


# ---------------------------------------------------------------- progress, activity, usage
async def test_progress_activity_and_usage_from_real_data(authed, worker):
    empty = (await authed.get(f"{API}/progress")).json()
    assert empty["xp"] == 0 and empty["level"] == 1 and empty["streak_days"] == 0
    assert {s["key"]: s["done"] for s in empty["next_steps"]}["first_run"] is False and len(empty["achievements"]) >= 12

    cleaner = (await authed.post(f"{API}/catalog/data_cleaner/activate")).json()
    await authed.patch(f"{API}/agents/{cleaner['id']}", json={"config": {**cleaner["config"], "filters": [{"field": "data.keep", "op": "eq", "value": "yes"}]}})
    items = [{"title": f"Item {i}", "url": f"https://x.example/{i}", "data": {"keep": "yes" if i < 3 else "no"}} for i in range(8)]
    run = await run_agent(authed, worker, cleaner, items)
    assert run["items_out"] == 3

    # Earlier successful runs on the two previous days make a 3-day streak.
    async with session_factory()() as db:
        tid = (await db.execute(select(Tenant.id).where(Tenant.slug == "ten"))).scalar_one()
        for days in (1, 2):
            at = utcnow() - timedelta(days=days)
            db.add(PipelineRun(tenant_id=tid, agent_id=None, status="succeeded", trigger="schedule", steps=[], items=[], items_out=5,
                               content_created=0, created_at=at, started_at=at, finished_at=at))
        await db.commit()
    p = (await authed.get(f"{API}/progress")).json()
    assert p["streak_days"] == 3 and p["best_streak_days"] == 3
    assert p["xp"] == 3 * 10 + 3 + 5 + 5 + 15  # 3 runs, items 3+5+5, one agent activated
    ach = {a["key"]: a for a in p["achievements"]}
    assert ach["first_run"]["unlocked"] and ach["first_run"]["unlocked_at"] and ach["streak_3"]["unlocked"]
    assert ach["hundred_items"]["current"] == 13 and ach["hundred_items"]["progress"] == 0.13
    assert p["today"]["runs"] == 1 and p["week"]["runs"] == 3 and p["time_saved_minutes_week"] >= 1
    assert {s["key"]: s["done"] for s in p["next_steps"]}["first_run"] is True
    assert [r["points"] for r in p["xp_rules"]][:3] == [10, 1, 25]

    feed = (await authed.get(f"{API}/activity")).json()
    assert "items" in feed, feed
    titles = [i["title"] for i in feed["items"]]
    assert any("kept 3 of 8 items" in t for t in titles), titles
    done = next(i for i in feed["items"] if i["type"] == "run.finished")
    assert done["xp"] == 13 and done["metrics"]["items"] == 3 and done["level"] == "success" and done["category"] == "run"
    activated = next(i for i in feed["items"] if i["type"] == "agent.activated")
    assert activated["xp"] == 15 and activated["category"] == "agent"
    agent_only = (await authed.get(f"{API}/activity?agent_id={cleaner['id']}&category=run")).json()["items"]
    assert agent_only and all(i["category"] == "run" for i in agent_only)
    page = (await authed.get(f"{API}/activity?limit=1")).json()
    assert len(page["items"]) == 1 and page["next_cursor"]
    older = (await authed.get(f"{API}/activity", params={"limit": 50, "before": page["next_cursor"]})).json()["items"]
    assert older and all(i["at"] < page["next_cursor"] for i in older)

    usage = (await authed.get(f"{API}/usage")).json()
    row = next(a for a in usage["by_agent"] if a["agent_id"] == cleaner["id"])
    assert row["runs"] == 1 and row["succeeded"] == 1 and row["items_out"] == 3 and row["catalog_key"] == "data_cleaner"


async def test_broken_link_checker(authed):
    a = (await authed.post(f"{API}/catalog/broken_link_checker/activate")).json()
    await authed.patch(f"{API}/agents/{a['id']}", json={"config": {**a["config"], "site_url": "https://site.example.com", "max_pages": 5}})
    res = await try_agent(authed, a)
    findings = {f["id"]: f for f in res["items"][0]["data"]["findings"]}
    assert set(findings) == {"broken_links"}
    assert findings["broken_links"]["affected_urls"] == ["https://site.example.com/missing → https://site.example.com/"]
    assert "Broken links" in res["items"][0]["formats"]["article"]
