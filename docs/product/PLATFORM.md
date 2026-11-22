# LayerFlow: universal AI agent platform

**Any company connects AI agents to its existing website or app, with no AI infrastructure of its own.**
A company gets a workspace, activates agents from the catalogue, configures them, chains them into workflows,
triggers them on a schedule, from its website or from its app, and watches every agent work live.
One shared LayerFlow install runs every customer, and each customer's agents, data, credentials and history stay isolated.

> LayerFlow started as the newsroom engine for The Executive Narrative (TEN). That engine still runs unchanged as the
> **Newsroom module**. The original plan is in [`original-ten-plan.md`](./original-ten-plan.md).

---

## 1. Customer journey

```
Sign up (or you create the client) ─► Connect website/app ─► Activate agents from the catalogue ─► Configure
   ─► Chain them into a workflow ─► Schedule / webhook / API trigger
   ─► Watch live activity ─► Approve ─► Results land on their site, CRM, channels and datasets
```

| Customer | What LayerFlow does for them |
| --- | --- |
| College discovery portal | Researches institutions, extracts courses, fees, placements and facilities into a dataset, finds permitted images, detects changes, writes SEO content, keeps the site fresh, and powers a real-time "compare colleges" assistant |
| The Executive Narrative | The governed editorial newsroom: discovery → research with citations → write → edit → SEO → QA → review → publish → LinkedIn |
| News / blog site | Topic monitoring → fact-checked research → persona writing → multi-format (article, LinkedIn, X, Instagram, newsletter, video script) → SEO → approval → auto-post |
| Hackathon / events site | Scrape open events → dedupe, keep open ones, sort by deadline → rewrite → save to the dataset the site renders, plus a finder assistant |
| Teaching institute (leads) | New lead → validate → dedupe → categorize → assign by rules → CRM update → follow-up reminder → daily report |
| Support / e-commerce / anything else | Support assistant over an FAQ dataset, price watch, document → data extraction, reports, notifications |

## 2. Core concepts

```
Platform (you, the operator)        plans · catalogue · health · all clients (support access is audited)
 └─ Workspace = one company         members + roles · plan & usage · audit log · notifications
     ├─ Agents        from the catalogue or custom; config versions, schedule, limits, tools & permissions,
     │                live activity, execution history, outputs; run / pause / resume
     ├─ Workflows     agent + approval steps, conditions, error policy; manual / schedule / webhook / API; versions
     │   └─ Runs      every execution step by step, from real events (SSE live stream)
     ├─ Content       multi-format outputs → approve → publish
     ├─ Datasets      structured records the agents maintain (colleges, events, products, leads…)
     ├─ Assistant     real-time Q&A + side-by-side comparison over a dataset (dashboard + website widget)
     ├─ Integrations  Next.js, WordPress, webhook, LinkedIn, Telegram, X, Ghost, Slack, Discord, Email, REST API;
     │                API keys with scopes, inbound webhooks, delivery history, SDKs, MCP
     └─ Newsroom      optional module (TEN editorial engine)
```

**Roles:** owner · admin · developer · operator · analyst · viewer. Every API call is checked against the caller's membership in the active workspace.
**Plans:** free · starter · pro · business · enterprise, each with limits on agents, runs/day, concurrent runs, records, API calls and members, plus access to premium agents. Quotas are enforced when work is queued. Payment checkout is **not** built in: a platform admin sets the plan, and a payment provider (Razorpay/Stripe) plugs into that one place later.

## 3. Agents: a catalogue on top of reusable engines

Customers pick from **48 catalogue agents** ([full guide](./agents.md)), for example Smart Web Scraper, URL Collector, Table Extractor, Image Scraper, Open-License Image Finder, Page Change Watcher, PDF Reader, Data Finder, Comparison Builder, Content Writer, Translator, Keyword Researcher, Lead Qualifier, CRM and Google Sheets Sync, and Alerts. Each one is a preset configuration of a reusable **agent engine**. Every engine works through the shared **tool registry**: web fetch, search, RSS, sitemap, HTML/AI extraction, SEO analysis, dataset read/write, publish, HTTP request, notify, image discovery and model generation. Each tool has typed input/output, permissions, timeouts and retries, and every call is audited.

| Engine | Category | What it does |
| --- | --- | --- |
| `web_scraper` | Collect | Modes: auto (AI from plain field names), CSS, tables, structured data (JSON-LD/OG/microdata), crawl; follows pagination and detail pages |
| `link_collector` | Collect | URLs from pages/sitemaps/search, include/exclude patterns, canonical and de-duplicated |
| `document_reader` | Collect | PDFs and documents from links → text + fields |
| `page_watcher` | Collect | Watches pages (or one element) and reports only what changed, before → after |
| `news_monitor` | Collect | Keywords/topics → Google News + feeds, deduped, recency-filtered |
| `researcher` | Collect | Question/topic → sources → evidence pack with citations |
| `image_finder` | Images | Page images + **open-license search first** (Openverse, Wikimedia Commons) with licence, credit, size, **perceptual hash** de-duplication and optional AI alt text |
| `persona_rewriter` | Create | Rewrites in a persona/brand voice, grounded in the source |
| `multi_format` | Create | One story → article, blog, LinkedIn, X thread, Instagram, Facebook, newsletter, video script, WhatsApp |
| `report_builder` | Create | Turns items/run output into a markdown report |
| `seo_optimizer` | Quality | Title, meta, slug, keywords, JSON-LD |
| `site_auditor` | Quality | Crawls a website → technical + on-page SEO report, broken links |
| `keyword_researcher` | Quality | Keyword ideas from free search suggestions + competitor pages, grouped by intent |
| `quality_gate` | Quality | Banned phrases, length, numbers-not-in-source, duplicates |
| `fact_checker` | Quality | Claims vs sources → verified / unsupported / contradicted |
| `data_transform` | Data | Dedupe, filter, sort, limit, rename, AI-categorize |
| `dataset_builder` | Data | Scrape into a dataset, or save pipeline items into one (upsert by key) |
| `change_detector` | Data | New / changed / unchanged vs the dataset, with field diffs |
| `comparer` | Data | Matches the same thing across sources → comparison table with the best value per field |
| `auto_publisher` | Deliver | Approved content → site and channels |
| `http_action` | Deliver | Call an allowlisted REST API (CRM, Sheets, internal) |
| `notifier` | Deliver | Telegram, Slack, Discord, email, webhook |
| `comparison_assistant` | Assist | Real-time answers + exact comparison tables from a dataset |
| `custom_llm` | Any | Your prompt + output fields |

**Build anything:** any chain of *collect → clean/sort → verify → write/format → save/publish/notify* works for any niche, with no new backend code. Every website needs something different, so there are no fixed bundles: customers pick the agents they need from the **48-agent catalogue** ([agent guide](./agents.md)), and each comes with a sensible preset they can tweak.

### Managing an agent

Every agent has its own page:

- **Overview**: status, current task, last/next run, success rate, duration
- **Live activity**: real execution events streamed as they happen (pages fetched, items extracted, tools called, waiting for approval)
- **Configuration**: validated form, model, instructions, limits, approval, schedule; every save is versioned and restorable
- **Tools & permissions**
- **History**: every execution with trigger, timing, tools, retries and errors
- **Outputs**: items, reports, dataset changes, content
- Controls: **Run, Pause, Resume, Disable, Schedule**

## 4. How the customer's website or app connects

| Site type | Easiest path | What they get |
| --- | --- | --- |
| **Next.js** | Copy `integrations/nextjs/lib/layerflow.ts` + the webhook route; set 3 env vars | Posts/datasets fetched with ISR caching; instant refresh on publish (signed webhook) |
| **WordPress / blog** | Add a *WordPress* connection with an Application Password (no plugin), **or** install `integrations/wordpress/layerflow-connector` | Auto-published posts with SEO meta (Yoast/RankMath/AIOSEO), shortcodes for the assistant and data tables |
| **Any website** | One `<script src=".../widget.js" data-key=… data-dataset=…>` tag | The real-time comparison assistant, in a Shadow DOM so the site's CSS can't break it |
| **Any backend** | Public REST API + RSS + signed webhooks | `/api/public/v1/content`, `/datasets/{slug}/records`, `/chat`, `/rss.xml` |
| **Their app triggers agents** | TypeScript / Python SDK or REST (`runs:write`) | Start a workflow or agent with input, poll status, get the output; idempotent |
| **AI clients** | Optional MCP adapter | Claude Desktop / IDE agents can query data and run workflows |

Details: [`docs/integrations/`](../integrations/README.md). Endpoint contract: [`docs/platform/API.md`](../platform/API.md).

## 5. Architecture

```
                 Client websites (Next.js · WordPress · any)        Social (LinkedIn · Telegram · X)
                        ▲  public API / widget / RSS                        ▲
                        │  signed webhooks                                  │
┌───────────────────────┴───────────────────────────────────────────────────┴──────────┐
│ VPS (Hostinger KVM 8: 8 vCPU · 32 GB)                         Caddy :443 (auto TLS)   │
│                                                                                     │
│  Next.js dashboard ──/api/v1──► FastAPI ──► Postgres (all state + job queue)        │
│  (operator + clients)            │   ▲                                              │
│                                  │   └── /api/public/v1 (API keys, CORS, rate limit)│
│                                  ▼                                                  │
│                      Worker: pipeline runs · scheduler · publishing (io lane)       │
│                                  │                                                  │
│                                  ▼                                                  │
│                      Ollama: fast 3B (chat) + writer 7B/14B + embeddings, warm       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Postgres table queue** (`FOR UPDATE SKIP LOCKED`): every pipeline run and publish is a persisted, retryable job. See [ADR-001](../decisions/ADR-001-postgres-queue.md).
- **Two worker lanes**: long model jobs (writing) never block publishing or scraping.
- **The assistant bypasses the queue.** Chat goes from the API straight to the warm fast model, so answers start in seconds even while a long article is being written.
- **Tenant isolation**: every row carries `workspace_id` (`tenant_id`). API keys are bound to one workspace. Connection secrets are Fernet-encrypted.
- **Models are local**: no per-token bill. Switching to a GPU box or a paid API means changing `OLLAMA_BASE_URL` or `MODEL_PROVIDER`. No code changes.

## 6. What runs where

| Mode | Command | Use it for |
| --- | --- | --- |
| **Demo (frontend only)** | `pnpm dev` with demo mode on | Showing the product from a laptop (MacBook) with no backend and no model. Sample data. [Guide](../setup/frontend-demo.md) |
| **Local dev** | API + worker + web, SQLite, Ollama or mock | Development. [Guide](../setup/local-dev.md) |
| **Production** | `sudo bash scripts/vps/install.sh` | The real thing on the VPS. [Guide](../setup/vps-hostinger-kvm8.md) |

## 7. Honest limits

- **CPU-only speed.** A full article plus five social formats takes about 3–8 minutes on KVM 8 with the 7B writer. That is fine for pipelines (they run in the background) and is why chat uses the 3B model. A GPU server makes everything 5–10× faster; the upgrade is a config change.
- **Scraping** respects robots.txt and rate limits and never bypasses logins, paywalls or CAPTCHAs. JavaScript-only sites may need a JSON endpoint or a sitemap instead.
- **X (Twitter)** posting is prepared for copy-paste unless the client provides API access. **LinkedIn** auto-posting needs an approved developer app. Both are honest fallbacks, not broken features.
- **Accuracy.** Agents are grounded in source text and quality-gated, but a human approval step stays on by default for anything published under a client's name.
- **Payments.** Plans, limits and entitlements are enforced, but there is no checkout yet. Connecting Razorpay or Stripe means calling the existing "set plan" action from their webhook.
- **Email invites.** No mail service is configured. New members get a one-time password shown to whoever invites them. Add SMTP to send invites by email.
- **Workflows are sequential** (with conditions, skips, error policies and approval steps). Parallel branches are not built.

## 8. Roadmap (next)

1. Payment provider checkout (Razorpay/Stripe) wired to plans.
2. Parallel branches + a drag-and-drop canvas for workflows.
3. Headless-browser scraping lane for JavaScript-heavy sites (Playwright), behind a feature flag.
4. Tenant knowledge bases with embeddings retrieval (documents/PDF upload) for support and research agents.
5. GPU model host + per-agent routing to paid APIs for premium clients.
