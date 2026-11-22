# LayerFlow — Product Explainer

> **One line:** LayerFlow is an AI agent platform you install once and sell to many clients — each client gets their own workspace where a team of AI agents collects data from the web, rewrites it in their voice, produces every format, checks quality and SEO, and publishes to their website and channels automatically.

---

## 1. The problem you are selling against

Every business today is told it needs AI. What they actually need is **work done**, not a chat box. The work looks the same everywhere:

- Someone has to **find** information (news, competitors, prices, colleges, events, leads, FAQs).
- Someone has to **clean** it (remove duplicates, keep only what is still valid, sort it).
- Someone has to **write** it in the company's voice, in many formats.
- Someone has to **check** it (facts, SEO, tone, banned phrases).
- Someone has to **put it on the website / CRM / social** at the right time.
- And someone has to **do it again tomorrow**.

Hiring for that is expensive and slow. Buying a chatbot does not solve it, because a chatbot produces text — it does not fetch live data, does not maintain a database, does not publish, and cannot be trusted to run unattended.

**LayerFlow is the system that does all six steps, continuously, inside the client's own website.**

---

## 2. What the product is

```
Client website (Next.js · WordPress · any site)
        ▲            ▲                    ▲
        │            │                    │
   public API    signed webhook      embed widget
        │            │                    │
┌───────┴────────────┴────────────────────┴──────────────────────────┐
│  LayerFlow workspace (one per client)                              │
│                                                                    │
│   Agents ──► Pipelines ──► Runs ──► Content ──► Connections         │
│      │                        │         │            │             │
│      └──► Datasets ──► Assistant (dashboard chat + site widget)    │
│                                                                    │
│   Roles · plans · audit log · usage · API keys · webhooks          │
└────────────────────────────────────────────────────────────────────┘
        │
   AI models (local open-weight, or any OpenAI-compatible endpoint)
```

Three sentences that describe the whole product:

1. **A client gets a workspace** — their own isolated space with agents, data, credentials and history.
2. **You build a pipeline from agents** — collect → clean → write → check → publish — and trigger it on a schedule, from their website form, or from their app via API.
3. **Results land where the client lives** — their Next.js/WordPress site, a dataset their pages read, Telegram/Slack/LinkedIn, or a webhook into their CRM. Every step is visible live, and a human can approve before anything is published under their name.

**Critical commercial point:** one install, unlimited workspaces. You are not shipping a copy of the software per client. You add a client in 15–20 minutes, and all of them share one server, one model process and one dashboard.

---

## 3. The customer journey (what a sale actually looks like)

```
Sign up / you create the client
   └─► Connect their website
        └─► Activate agents from the catalogue (or install a ready-made package)
             └─► Configure: sources, voice, fields, schedule, approval
                  └─► Chain them into a pipeline
                       └─► Trigger: every N minutes / webhook / API / manual
                            └─► Watch live activity
                                 └─► Approve
                                      └─► Published to site + social + CRM + datasets
                                           └─► Repeats forever, with change detection
```

| Stage | Time | Who |
| --- | --- | --- |
| Create workspace + apply a package | 1 minute | You |
| Configure agents (sources, persona, fields) | 10–15 minutes | You with the client |
| Connect the site (Next.js / WordPress / one script tag) | 10 minutes | Their developer, or you |
| First real run + review | same day | You |
| Approval off, fully autonomous | after 1–2 weeks of trust | You + client |

---

## 4. How it works end to end — one real example

This is the story to tell in a demo. A news client, "MarketPulse", has a pipeline called **Daily market desk** that runs every hour.

**09:00 — Collection.**
Two agents start. `Trend Monitor` asks Google News and the client's trusted RSS feeds for the last 12 hours of stories matching `Sensex, Nifty, RBI policy, IPO, SEBI, rupee`. `Market Scraper` reads specific pages (exchange press releases, regulator notices, sitemaps) and extracts fields — `headline, date, key_numbers, companies`.

Both are polite crawlers: they obey `robots.txt`, rate-limit per domain (1 request per domain at a time by default), cache pages for 7 days, and never bypass logins, paywalls or CAPTCHAs.

**09:02 — Cleanup.**
`Data Transform` de-duplicates against today's items, drops anything older than the window, and trims to 20 items. Result: *42 found → 14 kept*.

**09:03 — Writing.**
`Persona Rewriter` writes each story in the owner's voice, grounded in the source text. The persona is a configuration string, e.g. *"Ex-banker, 20 years in markets. Direct, numbers first, explains what it means for a retail investor. Short sentences. No hype."* Length, language and temperature are settings.

**09:06 — Multiplication.**
`Format Studio` turns each finished story into every format at once: article, blog, LinkedIn post, X thread, Instagram caption, Facebook post, newsletter blurb, 60-second video script, WhatsApp message. One story in, up to nine assets out.

**09:07 — Quality.**
`SEO Optimizer` writes title tag, meta description, slug, keywords and JSON-LD.
`Quality Gate` blocks banned phrases, flags numbers that do not appear in the source, and drops near-duplicates of the last three days. `Fact Checker` (optional) labels each claim verified / unsupported / contradicted.

**09:08 — Human gate.**
Because **Require approval** is on, the run stops at `awaiting_approval`. The client opens `/review` on their phone, reads the piece, and clicks **Approve**.

**09:08 — Delivery.**
`Auto Publisher` pushes the approved content to the connections the client chose: the Next.js site (which revalidates instantly via a signed `content.published` webhook), WordPress (as a post with SEO metadata), the LinkedIn page, the Telegram channel. The X thread is prepared copy-ready — honest fallback, because X's API access is not granted to everyone.

**09:09 — Done, and it starts again in 51 minutes.**

Every one of those steps is a **real, timestamped event** in the UI — pages fetched, items extracted, tools called, model calls, tokens, durations, retries, errors. Nothing is animated or faked: the dashboard reads the same event log the runtime wrote while doing the work.

### The same shape works for any niche

```
collect  →  clean/sort  →  verify  →  write/format  →  save / publish / notify
```

Only the sources and the fields change. That is why one product sells to a news site, a college portal, a hackathon site, an e-commerce store and a support desk.

---

## 5. The building blocks (what you show and configure)

### 5.1 Workspaces
One per client. Contains members, roles, plan and usage, agents, pipelines, runs, content, datasets, connections, API keys, audit log and notifications. Every row in the database carries the workspace id, so clients can never see each other's data.

### 5.2 Agents — 19 engines, 26 ready-made presets
An **engine** is the actual capability. A **catalogue agent** is a preset of an engine (name, prompt, defaults) that a client can activate in one click.

| Category | Engines | What the client gets |
| --- | --- | --- |
| **Collect** | `web_scraper`, `news_monitor`, `researcher`, `image_finder` | Pages/RSS/sitemaps/JSON → structured items; topics → deduped news; question → evidence pack with citations; permitted lead images with credit |
| **Create** | `persona_rewriter`, `multi_format`, `report_builder` | Brand-voice rewriting grounded in source; 1 story → 9 formats; items → markdown report |
| **Quality** | `seo_optimizer`, `site_auditor`, `quality_gate`, `fact_checker` | Title/meta/slug/keywords/JSON-LD; full technical+on-page SEO audit; banned phrases, length, invented numbers, duplicates; claim verification |
| **Data** | `data_transform`, `dataset_builder`, `change_detector` | Dedupe/filter/sort/rename/AI-categorize; scrape or save into a dataset (upsert by key); new/changed/unchanged with field diffs |
| **Deliver** | `auto_publisher`, `http_action`, `notifier` | Site + social publishing; allowlisted REST calls (CRM, Sheets, internal); Telegram/Slack/Discord/email/webhook |
| **Assist** | `comparison_assistant` | Real-time answers **and** exact side-by-side tables computed from dataset records |
| **Any** | `custom_llm` | The client's own prompt and output fields — covers the long tail with no code |

Catalogue presets include: SEO Site Auditor · SEO Optimizer · Research Analyst · News Discovery · Topic Monitor · Content Writer · Editor/Persona · Multi-format Studio · Fact Checker · Source Verifier · Web Data Extractor · College/Institution Researcher · Image Discovery · Change Detector · Data Cleaner/Sorter · Dataset Sync · Lead Qualifier · CRM Sync · Customer Support Assistant · Notifier/Digest · Report Builder · Auto Publisher · Translator · Hackathon/Event Finder · Comparison Assistant · Custom AI Step.

Every engine works through a shared **tool registry** (fetch, search, RSS, sitemap, HTML/AI extraction, SEO analysis, dataset read/write, publish, HTTP, notify, image discovery, model generation). Each tool has typed input/output, permissions, timeouts, retries — and every call is audited. That is the governance story: **the agents cannot do anything the platform has not explicitly allowed.**

### 5.3 Pipelines, runs and live activity
A pipeline is a sequence of agent steps with optional **approval steps**, **conditions**, **error policy** (`stop` / `continue`), **retries** and labels. It can be triggered manually, on a schedule, by an inbound webhook (`/hooks/pipelines/{id}?token=…`), or by the public API.

Every execution is a **run** with a step-by-step log and a live SSE stream. A run log reads like a sentence: *scraped 42 → 18 after dedupe/open-only/sort → 18 rewritten → 18 saved*.

Pipelines and agent configuration are **versioned** — every save creates a new version, restorable, so a bad edit is one click away from being undone.

### 5.4 Content, review and publishing
All generated output lands in a content inbox: **all formats of one story, side by side**. The client edits, approves or rejects (with a reason). Approving resumes the paused run and the publisher step fires. Publishing goes to any combination of connections, and every delivery — status, URL, error, retry — is recorded.

### 5.5 Datasets — the part that makes the site valuable
A dataset is a typed table the agents maintain: colleges, hackathons, products with prices, leads, FAQs, listings. Fields are defined by you, records are upserted by a key field, and changes are detected with field-level diffs.

The client's website then reads live data with one call:

```
GET /api/public/v1/datasets/colleges/records?sort=ranking:asc
```

Their list pages, detail pages and tables update themselves when agents refresh the data. No CMS migration, no manual data entry.

### 5.6 The assistant — real-time answers that cannot invent numbers
Two uses of the same engine:

- **Dashboard playground** — you and the client ask questions over a dataset.
- **Website widget** — one `<script>` tag adds a comparison assistant to any page (Shadow DOM, so the site's CSS cannot break it).

Ask *"Compare IIT Bombay vs BITS Pilani for CSE, fees and placements"* and the visitor gets a **side-by-side table built directly from the records** (fees, average package, placement rate, NIRF rank) with the better value highlighted, plus a short plain-language explanation and follow-up suggestions.

**The commercial line here:** the table is computed from the database, not generated by the model, so it cannot hallucinate a fee or a rank. The model only writes the sentence around the numbers, and it only sees those records.

### 5.7 Connections and integrations — 11 ways to deliver
`Next.js` · `WordPress` · `Webhook` · `LinkedIn` · `Telegram` · `X (Twitter)` · `Ghost` · `Slack` · `Discord` · `Email (SMTP)` · `REST API`.

| Client's site | What you do | Effort |
| --- | --- | --- |
| **Next.js** | Copy 2 files + 3 env vars → ISR-cached posts/datasets, instant refresh on publish | ~10 min |
| **WordPress** | Add a connection with an Application Password (no plugin) **or** install one plugin file → auto posts + SEO meta (Yoast/RankMath/AIOSEO) + shortcodes | ~10 min |
| **Any site** (Webflow, Wix, Shopify, plain HTML) | Paste one script tag | 2 min |
| **Custom backend** | Public REST API + signed HMAC webhook (`X-LayerFlow-Signature`) | ~30 min |
| **Their app triggers agents** | TypeScript / Python SDK or REST (`runs:write`), idempotent keys, poll for result | A few lines |
| **AI clients** | Optional MCP adapter (Claude Desktop, IDE agents) | Optional |

Also available: **API keys** with scopes (`content:read`, `datasets:read`, `assistant:chat`, `runs:write/read`), an **RSS feed** of published content (`/api/public/v1/rss.xml`), inbound **pipeline webhooks** (so a website form, cron job or Zapier can start a run), and full **delivery history** per connection.

### 5.8 The Newsroom module (the original product)
An optional, governed editorial engine inside the same install: discovery → research with citations → write → edit → SEO → QA → review queue → scheduled publishing, with six editorial categories. It is what ran The Executive Narrative and it still works unchanged. Sell it to media clients; ignore it for everyone else.

---

## 6. Demo tour — the screen order that sells

Run the dashboard and walk these in order. Each screen answers a different client doubt.

| # | Screen | What to say |
| --- | --- | --- |
| 1 | `/login` → **Explore the live demo** | "No setup, no login. This is the real product on sample data." |
| 2 | `/` Dashboard | "This is what the client sees every morning: what ran, what it produced, what needs approval." |
| 3 | `/clients` + `/platform` | "One install, every client in its own workspace. This is your business view." |
| 4 | `/catalogue` → activate an agent | "Hundreds of use cases, but only 19 engines — pick a preset, it is live in one click." |
| 5 | `/agents` → open one → **Run** | "Watch it work: every page fetched, every tool called, in real time. This is not a progress bar." |
| 6 | `/pipelines` → **Run now** | "Agents chained: collect, clean, write, check, publish. This is the product." |
| 7 | `/content` + `/review` | "All nine formats of one story in one place. Approval is one tap." |
| 8 | `/datasets` | "This is the client's live database — their site reads it, and it updates itself." |
| 9 | `/assistant` | "Ask it to compare two records. The table comes from the database, not the model." |
| 10 | `/connections` + `/developers` | "Website, WordPress, social, CRM, API keys, webhooks — already built." |
| 11 | `/settings/usage` + `/settings/audit` | "Every run, token and action counted and logged. This is how you bill and how you prove value." |

*(Dashboard screens available: dashboard · clients · platform/health · catalogue · agents (+ detail, new) · pipelines (+ detail) · runs (+ detail) · content (+ detail) · review · studio · news · newsroom · datasets (+ detail) · assistant · connections · webhooks · developers · activity · settings (workspace, members, usage, audit) · calendar · social · SEO.)*

---

## 7. Three stories you can tell a client (all real, all on one install)

### A. News / media site — "your desk that never sleeps"
Every hour: monitor topics → scrape trusted sources → rewrite in the owner's voice → 9 formats → SEO + quality gate → approval → website + LinkedIn + Telegram, X thread copy-ready. **Sells on:** publishing volume without hiring, consistent voice, and a fact/quality gate before anything goes out.

### B. College portal — "the comparison site that stays correct"
Collect college pages into a dataset (fees, placements, NIRF rank, courses) → weekly refresh of fees and placements → admission-news articles → live comparison assistant on the site. **Sells on:** structured data nobody has to type, pages that never go stale, and a comparison assistant that cannot invent numbers.

### C. Hackathon / events site — "always current listings"
Scrape listing pages and organiser feeds → dedupe, drop closed events, sort by deadline, AI-categorize → rewrite each listing → save to the dataset the site renders → optional social roundup. **Sells on:** a listings site that fills itself and never shows a dead event.

The same chain sells to: job boards, scholarships, real-estate listings, product catalogues with price watch, lead intake + CRM routing, and customer support over an FAQ dataset.

---

## 8. Architecture — the answers to "will this hold up?"

```
                    Client websites (Next.js · WordPress · any)      Social (LinkedIn · Telegram · X)
                           ▲  public API / widget / RSS                    ▲
                           │  signed webhooks                              │
┌──────────────────────────┴───────────────────────────────────────────────┴──────────────┐
│  VPS (8 vCPU · 32 GB is enough)                                    Caddy :443 (auto TLS) │
│                                                                                         │
│   Next.js dashboard ──/api/v1──► FastAPI ──► Postgres (state + job queue)               │
│   (your operator view + clients)      │                                                 │
│                                       └──► /api/public/v1 (API keys, CORS, rate limits) │
│                                       ▼                                                 │
│                    Worker: pipeline runs · scheduler · publishing (two lanes)           │
│                                       ▼                                                 │
│                    Models: fast 3B (chat) + writer 7B/14B + embeddings, kept warm       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

Six points worth saying out loud:

1. **Every run is a persisted job** in a Postgres queue (`FOR UPDATE SKIP LOCKED`). A server restart does not lose work; failed steps retry.
2. **Two worker lanes** — long writing jobs never block scraping or publishing. The pipeline keeps moving.
3. **The assistant bypasses the queue** — chat goes straight to the warm fast model, so answers start in seconds even while an article is being written.
4. **Strict tenant isolation** — every row carries the workspace id; API keys are bound to one workspace; connection secrets (WordPress passwords, bot tokens, webhook secrets) are encrypted at rest (Fernet).
5. **Models are local by default** — no per-token bill. Switching to a GPU box or a paid API is a config change (`OLLAMA_BASE_URL` / `MODEL_PROVIDER`), not a rewrite.
6. **Nothing is fabricated in the UI** — live activity is the real event log, and the whole backend test suite (116 tests) runs offline with no model and no network.

---

## 9. Governance — the answers to "is it safe to let AI publish for us?"

| Concern | How the product answers it |
| --- | --- |
| "AI will write nonsense under our name" | Human **approval step** is on by default; runs pause at `awaiting_approval` and resume on approve. |
| "It will invent numbers" | Agents are **grounded in source text**; `quality_gate` flags numbers not in the source; the comparison assistant computes tables from records. |
| "It will scrape things it shouldn't" | Respects `robots.txt`, per-domain rate limits, no login/paywall/CAPTCHA bypass, no private network access unless explicitly allowed. |
| "Who did what?" | Full **audit log** per workspace, per-execution history, delivery history, and version history for agents and pipelines. |
| "Our people shouldn't see other clients' data" | Workspace isolation + 6 roles (owner, admin, developer, operator, analyst, viewer); support access is read-only and audited. |
| "We need to limit cost" | Plans enforce limits on agents, runs/day, concurrency, records, API calls and members at queue time. |
| "Can our own app control it?" | Scoped API keys, idempotent run endpoints, signed outbound webhooks, inbound pipeline webhooks, SDKs. |

---

## 10. Plans (configured in code, enforced at queue time)

| Plan | ₹/month | Agents | Runs/day | Concurrent | Records | API calls/day | Members | Premium agents |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Free | 0 | 5 | 50 | 1 | 1,000 | 500 | 3 | — |
| Starter | 1,999 | 15 | 300 | 2 | 10,000 | 5,000 | 5 | — |
| Pro | 4,999 | 40 | 1,500 | 3 | 100,000 | 50,000 | 15 | ✓ |
| Business | 14,999 | 150 | 10,000 | 6 | 1,000,000 | 500,000 | 50 | ✓ |
| Enterprise | custom | unlimited | unlimited | 12 | unlimited | unlimited | unlimited | ✓ |

Honest note to keep in your pocket: **plans, limits and entitlements are enforced, but checkout is not built.** A platform admin sets the plan; connecting Razorpay or Stripe means calling that one existing action from the payment webhook. Say this before a client asks — it is a 1-day integration, not a gap in the product.

---

## 11. Speed, cost and honest limits

Say these numbers up front. Credibility closes deals faster than hype.

- **Speed:** a full article plus five social formats takes **3–8 minutes** on an 8-vCPU CPU-only server with the 7B writer. That is fine for pipelines (they run in the background) and is exactly why chat uses the small model. A GPU host makes everything **5–10× faster** — same software, config change only.
- **Cost:** self-hosted on one VPS, with open-weight models, there is **no per-token bill**. That is the single biggest line item a client would otherwise pay monthly.
- **Scraping:** respects robots.txt and rate limits; JavaScript-only sites may need a JSON endpoint or sitemap instead of HTML scraping. (A headless-browser lane is on the roadmap.)
- **X (Twitter):** posting is prepared copy-ready unless the client provides API access. **LinkedIn** auto-posting needs an approved developer app. Present these as honest fallbacks, not missing features.
- **Accuracy:** grounded + quality-gated + human approval by default. Never promise "zero review forever" — promise "review becomes optional once you trust it".
- **Email invites:** no mail service wired yet; new members get a one-time password. Add SMTP to send invites by email.
- **Workflows are sequential** — conditions, skips, error policies and approval steps exist; parallel branches do not.
- **On the roadmap:** payment checkout, parallel branches + drag-and-drop canvas, headless-browser scraping lane, tenant knowledge bases with embeddings, GPU model host / per-agent paid routing.

---

## 12. Onboarding a new client (your delivery checklist)

| Day | What you do |
| --- | --- |
| **Day 0 (20 min)** | Create workspace → pick the closest package → adjust agents (sources, persona, fields, schedule). |
| **Day 0 (10 min)** | Connect the site: Next.js files, WordPress connection, or one script tag. Create the API key. |
| **Day 0** | First manual run. Read the run log with the client. Approve the first piece together. |
| **Day 1–3** | Keep approval **on**. Client sends edits; you tune the persona and the quality gate. |
| **Week 1** | Turn on the schedule. Show `/settings/usage` — runs, items, tokens — so the value is a number, not a feeling. |
| **Week 2** | Approval off for low-risk formats (social), or keep it on and approve from a phone. Add the assistant widget if they have a dataset. |
| **Month 2** | Add the second pipeline (SEO audit, lead routing, price watch) — same workspace, same price conversation, more value. |

**Rule that keeps clients happy:** one new pipeline at a time, approval on, reviewed for a week. Never launch five automations on day one.

---

## 13. The 60-second pitch (say it roughly like this)

> "Right now your team spends hours a day finding stories, cleaning spreadsheets, writing posts, checking SEO and uploading them. We install a system that does that whole loop on your own website, in your voice, on your schedule.
>
> It watches the sources you trust, writes it the way you write, turns one story into every format you need, checks the facts and SEO before anything goes out, and then publishes to your site, LinkedIn and Telegram — with a human approval step you control.
>
> It also keeps a live database that your site reads directly, and adds a real-time assistant so your visitors can compare and ask questions and get answers built from your own data.
>
> You do not hire anyone, you do not buy per-token AI, and it runs on one server. We set up the first workflow together this week, and you approve everything until you trust it."

### Three objections and the answers

| Objection | Answer |
| --- | --- |
| "We already use ChatGPT." | "ChatGPT writes text when you ask. This fetches live data, keeps a database, checks facts, publishes on schedule and logs every action. It is the work, not the chat." |
| "AI content will damage our brand." | "Nothing publishes without your approval until you turn it off. Every number is checked against the source, banned phrases are blocked, and the comparison tables are computed from the database — they cannot hallucinate." |
| "What if it breaks or writes junk?" | "Every run is logged step by step, pipelines are versioned and restorable, failed steps retry, and a paused agent is skipped instead of half-running. You see exactly what happened, when." |

---

## 14. Running it for a sales call

**Laptop only, no backend, no model — perfect for a pitch:**

```bash
cd apps/web
NEXT_PUBLIC_DEMO_MODE=true pnpm dev     # http://localhost:3000
```

Sample data for three workspaces (MarketPulse News, CollegeCompass, The Executive Narrative). Clicking, creating agents, running pipelines (steps animate), approving content and chatting all work. State is in memory and resets on reload.

**Real end-to-end on a dev machine (real scraping, real database, real queue):**

```bash
cd apps/api && python3.12 -m venv .venv && .venv/bin/pip install -e ".[dev]"
# create apps/api/.env (see docs/setup/local-dev.md §2.3), then:
.venv/bin/python -m app.cli migrate && .venv/bin/python -m app.cli bootstrap
cd ../.. && WEB_PORT=3000 ./scripts/dev.sh     # API :8000 + worker + dashboard :3000
```

With no model available, set `MODEL_PROVIDER=mock` (deterministic, clearly labelled, fine for flows — never for real publishing). For real writing, point `MODEL_PROVIDER` at Ollama or any OpenAI-compatible endpoint.

**Production (what you actually sell):**

```bash
sudo bash scripts/vps/install.sh    # Caddy auto-HTTPS, Postgres, worker, models
```

---

## 15. Glossary (so you never get caught on a term)

| Term | Meaning |
| --- | --- |
| **Workspace** | One client's isolated space. The unit you sell. |
| **Agent** | One job: scraper, writer, SEO, publisher… Built from an engine + config. |
| **Engine** | The 19 underlying capabilities. Agents are presets of these. |
| **Catalogue** | The shop of ready-made agents a client can activate in one click. |
| **Pipeline** | Agents chained in order, with approval steps, triggers and error policy. |
| **Run** | One execution of a pipeline — the thing with the live log. |
| **Content item** | One story with all its formats, waiting to be approved/published. |
| **Dataset** | A typed table agents maintain; the client's site reads it over the public API. |
| **Assistant** | Real-time Q&A + comparison over a dataset (dashboard and website widget). |
| **Connection** | A destination: Next.js, WordPress, LinkedIn, Telegram, CRM, email… |
| **API key** | Scoped credential (`lf_pk_…`) a client's site uses on the public API. |
| **Package / blueprint** | A ready-made team (agents + pipelines + dataset) installed in one click. |

**Ready-made packages:** News media autopilot · College comparison portal · Executive newsroom · Blog SEO autopilot · E-commerce price watch · SEO automation · Lead management · Customer support · Hackathon/event listings.

---

## 16. Where to read more

| Topic | File |
| --- | --- |
| Platform concepts, limits, roadmap | [`docs/product/PLATFORM.md`](docs/product/PLATFORM.md) |
| Full client playbooks (news, colleges, hackathons) | [`docs/product/use-cases.md`](docs/product/use-cases.md) |
| API contract (dashboard + public + webhooks) | [`docs/platform/API.md`](docs/platform/API.md) |
| Connect a client site | [`docs/integrations/`](docs/integrations/README.md) |
| Local setup / demo mode / models | [`docs/setup/`](docs/setup/local-dev.md) |
| Production deploy + runbook | [`docs/setup/vps-hostinger-kvm8.md`](docs/setup/vps-hostinger-kvm8.md) · [`docs/ops/runbook.md`](docs/ops/runbook.md) |
| Architecture decisions | [`docs/decisions/`](docs/decisions/ADR-007-multi-client-platform.md) |

---

*LayerFlow — one install, a different AI team for every client.*
