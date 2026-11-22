# Beyond 9TO5 Buildathon — LiveDesk inside LayerFlow
### Presentation brief (problem → solution → product → sponsors → business → demo)

> **Repo:** `Rohit94r/Buildthon-paytm` · **Tracks chosen:** Track 1 (SerpApi) + Track 2 (You.com) · **Event:** Beyond 9TO5 Buildathon

---

## 0. Read this first — how to position the project

**One platform. One product. Two tracks.**

- **LayerFlow** is the full product: a multi-tenant AI agent platform (FastAPI + Next.js) with 26 agent kinds, 50 ready-made agent presets, pipelines, datasets, run logs, assistant chat, public API and SDKs.
- **LiveDesk** is the **research desk / dashboard inside LayerFlow** — a workspace like the newsroom, college, hackathon and SEO workspaces. It is not a separate app and not a wrapper around the platform.
- **SerpApi and You.com are capabilities of that platform.** They are first-class agent kinds and tools, and they also power ordinary agents (Research Analyst, News Monitor, SEO Auditor) and the assistant. That is the whole point: *live, cited web evidence is available to every agent in the product, not just to the demo page.*

**Track strategy — say this out loud:**
> "Most teams pick one sponsor track and go deep. We picked two — SerpApi for structured, machine-readable signals and You.com for a cited, synthesized answer — and made them work together in one evidence flow. The judges get two real integrations plus the story of why both are needed."

Do **not** say "this is built on top of a different platform" or "these are two different things". Say: **"LiveDesk is a desk inside the same agent platform; these agents are the platform's agents."**

---

## 1. The one-line pitch

**LiveDesk turns one question into a verifiable research brief: SerpApi collects fresh structured signals, You.com writes a cited answer, and the same evidence grounds the whole agent platform's assistant, pipelines and datasets.**

30-second version:
> "Ask a question. SerpApi fans out to Web, News, Jobs, Shopping, Maps and Scholar in parallel; You.com answers the same question with numbered citations. Both come back in one response, on one screen, with source links you can open. Then the research goes into a dataset, a run log and an assistant that keeps citing live sources on follow-up questions. It's a research desk inside a working agent platform — not a chatbot with links."

---

## 2. Problem — real, specific, easy to feel

Students, founders, analysts and news desks need answers that are **fresh** and **checkable**. Today they either ask a chatbot and get:

1. **Stale data** — the model's training cutoff, not today's web.
2. **No citations** — a confident sentence with no way to verify it.
3. **Tab switching** — five searches, five sites, copy-paste into a doc; the research is not reusable.
4. **No workflow** — the output cannot be turned into a dataset, a scheduled run, a report or a team process.
5. **No structure** — search results are HTML noise; teams still manually clean them into tables.

The deeper problem: **AI answers and real-time evidence live in different tools.** Search gives you links without synthesis; chatbots give you synthesis without fresh links.

---

## 3. Solution — what the product actually does

```
The question (typed in LiveDesk, or a row in a 10-record research dataset)
        │
        ▼
POST /api/v1/livedesk/research
        │
        ├── asyncio.gather (parallel) ──► SerpApi /search.json
        │                                  google · google_news · google_jobs
        │                                  google_shopping · google_maps · google_scholar
        │                                  + /extract for full page markdown
        │
        └──────────────────────────────► You.com /v1/answer
                                           answer + citations[] + results.web[]
        ▼
ONE response: cited answer · numbered sources · per-engine result cards
              evidence block · provider · degraded flag · latency
        ▼
Saved as agent items → dataset records → run log → assistant follow-ups with the same live sources
```

### The screen (LiveDesk desk inside LayerFlow)
- Header status pill: **"Sponsor keys connected"** (or honestly **"Demo mode · sample data"**).
- Question presets (e.g. *"AI agent startup funding in India this month"*).
- Six engine toggles: Web / News / Jobs / Shopping / Maps / Scholar; location + result count (3/5/8/10).
- **Run research** → You.com cited answer panel with clickable `[1] [2]` sources; SerpApi engine cards below with title, snippet, publisher, date and live URL.
- **Assistant** tab: *Live sources on* → answer plus "Live sources" list. Explicit `live_sources: false` really turns it off (fixed).
- **Catalogue**: `SerpApi Live Search` and `You.com Cited Researcher` are installable agent presets like any other agent in the platform.
- **Workspaces → LiveDesk**: seeded team of 7 agents, 1 manual pipeline, 1 dataset with 10 sample questions.

---

## 4. Why BOTH SerpApi and You.com (the question judges will ask)

| Need | SerpApi | You.com |
| --- | --- | --- |
| What it gives | **Structured facts**: 6 engines, positions, prices, dates, ratings, places, links | **Synthesized answer** with inline `[n]` citations |
| Strength | Machine-readable, filterable, comparable, good for tables | Readable narrative; every claim attached to a source |
| Weakness alone | Lots of results, no answer | One answer, less structured comparison data |
| In our product | Collects signals, feeds datasets/comparisons, deepens pages via Extract | Writes the cited brief and grounds the assistant |
| Business value | "What exactly changed, and where?" | "What does it mean, and how do I verify it?" |

**Answer in one line:** *SerpApi is the evidence pipeline; You.com is the cited narrator. Together they give fresh data **and** a verifiable answer — neither alone does both.*

---

## 5. Sponsor integration — exact technical detail

### 5.1 SerpApi (Track 1)
File: `apps/api/app/services/sponsor.py`, agent: `app/platform/kinds/serpapi_search.py`, tools: `serpapi.search`, `serpapi.extract`.

- `GET https://serpapi.com/search.json?engine=...&q=...&api_key=...&gl=in&hl=en&num=...`
- Engines and native buckets normalized into one `SearchHit`:

| Engine | Native bucket | We normalize |
| --- | --- | --- |
| `google` | `organic_results` | title, snippet, link, source, date |
| `google_news` | `news_results` | headline, publisher, date |
| `google_jobs` | `jobs_results` | role, company, location, apply link |
| `google_shopping` | `shopping_results` | product, price, seller |
| `google_maps` | `local_results` | place, address, rating |
| `google_scholar` | `organic_results` | paper, publication info |

- `SearchHit` = `title · url · summary · source · published_at · position · engine · provider · extra`. One shape for the whole UI.
- `GET /extract?api_key=...&url=...&output=md` → full page markdown; the `serpapi_search` agent can deepen its top N hits with `extract_top`.
- Agent runs multiple queries (`max_queries`), **de-duplicates by URL**, and writes `ctx.outputs["report"]` + FlowItems with `data["engine"]`, `data["sources"]`.
- Keys from server settings only (`SERPAPI_API_KEY`, alias `SERPAPI_KEY`); never from the request, never in cache keys, logs or responses.

### 5.2 You.com (Track 2)
Same service module; agent: `app/platform/kinds/you_research.py`, tools: `you.search`, `you.answer`.

- `POST https://api.you.com/v1/search` with `X-API-Key`, `{ query, count, freshness }` → `results.web[]` normalized to hits.
- `POST https://api.you.com/v1/answer` with `{ query, country, language }` → `answer`, `citations[]`, `results.web[]` mapped to `CitedAnswer`.
- Client also tries `https://ydc-index.io` (some keys are scoped there); alias `YDC_API_KEY` supported.
- `you_research` has two modes: **answer** (cited narrative) and **search** (cited brief from search hits). Citations are stored on the item and rendered in the article format.
- `cited_evidence()` gives the assistant numbered evidence: You.com search first, SerpApi News as second live source. Answer always returns `sources[]` and `sources_degraded`.

### 5.3 Where else the sponsor data is used (this is the USP)
Live evidence is not trapped in the demo page. It is wired into **ordinary platform agents** via the tool registry, each with `live_sources: true` in config:

| Agent kind | What the sponsor API does for it |
| --- | --- |
| `comparison_assistant` | `live_sources` toggle → cited evidence on any dataset question |
| `researcher` (Research Analyst) | SerpApi results become candidate sources (snippets kept when a page is unfetchable); You.com answer appended with citations |
| `news_monitor` (News Monitor) | SerpApi `google_news` results become real-time items alongside/alternative to RSS feeds |
| `site_auditor` (SEO Site Auditor) | SerpApi discovers same-host pages the sitemap misses; You.com adds a cited live-context section to the SEO report |
| `serpapi_search`, `you_research` | Dedicated sponsor agent kinds, installable from the catalogue |

All of these go through `invoke(ctx, "serpapi.search" | "you.search" | "you.answer")`, so every run shows `tool.called` / `tool.result` events, tool allowlists and timeouts. The seeded LiveDesk workspace has **7 agents**, a **5-step manual pipeline** (`Web Signal Collector → News Signal Monitor → Live Web Researcher → Live SEO Auditor → Cited Answer Desk`) and a **10-record sample research dataset** for a realistic end-to-end demo.

### 5.4 Reliability / cost / honesty (say these numbers)
| Concern | Handling |
| --- | --- |
| Missing key | Deterministic sample results with `provider="demo"`; UI shows **sample** badge. Nothing pretends to be live. |
| Network error / 401 / quota | Caught per call; sample data returned; **failed results are never cached** (fixed), so a retry recovers immediately. |
| Sponsor slowdown | 12 s client timeout; tool timeout 15 s; parallel fan-out keeps latency near the slowest single call. |
| Repeated demo runs | 5-minute in-process cache keyed by query/engine/count; API key excluded from key and logs. |
| Partial outage | Response `degraded: true` if **any** sponsor fails; answer-level and collection-level flags too (fixed). |
| Credit safety | One You.com answer call per research run; answer's own web results reused for evidence; zero credits spent in tests (mocked HTTP). |

---

## 6. Platform features (the product around the demo)

- **26 agent kinds / 50 catalogue presets** — collectors, writers, SEO, QA, publishing, data, sponsor agents; installable with one click.
- **Pipelines** — sequential steps, schedules, manual trigger, version history, approvals, run logs, cancel/retry.
- **Datasets** — keyed records, compare fields, 10 sample research questions in LiveDesk, import/upsert, assistant over any dataset.
- **Assistant** — computed comparison tables (no hallucinated numbers) plus optional live sponsor citations.
- **Multi-tenancy** — workspaces, roles and permissions, members, usage/audit, plan limits enforced at queue time.
- **Integrations** — connections for CMS/social/webhook, signed webhooks, scoped public API keys, TypeScript/Python SDKs.
- **Demo mode** — the whole UI runs on clearly-labelled sample data without a backend, so judges can click immediately.

---

## 7. USP — why this wins on stage

1. **Two sponsor tracks, one flow.** Most teams integrate one API and stop. We combine structured evidence (SerpApi) and cited synthesis (You.com) in one response and one story.
2. **Sponsors become platform capabilities.** Four sponsor tools + two agent kinds + three ordinary agents that opt in with one toggle. Judges can see the API become an agent, a dataset, a run log and a report.
3. **Citations by construction.** Sources are structured data returned by the API and rendered with links — not a model "remembering" URLs.
4. **Credit-aware and honest.** Cache, one answer call per run, labelled demo data, degraded flags, key never logged. This is production thinking, not a hack.
5. **Real product underneath.** A working multi-tenant agent platform with 148 passing tests means the demo is not a one-off UI.

---

## 8. 90-second demo script (do exactly this)

1. Open **http://localhost:3000/livedesk**. Point at the status pill: **Sponsor keys connected**.
2. Pick preset **"AI agent startup funding in India this month"**. Toggle **Web + News**. Set **5 results**.
3. Press **Run research**. Say: *"Both sponsors are being called in parallel — structured SerpApi engines and the You.com answer."*
4. Show the **cited answer** and click a numbered source — real live URL, opens in a new tab.
5. Show the **SerpApi engine cards** — publisher, date, snippet, live link. Mention the other four engines (Jobs, Shopping, Maps, Scholar) are one toggle away.
6. Go to **Assistant**, select the **LiveDesk** workspace assistant, switch **Live sources on**. Ask: *"What should we research first about AI agents in India?"* → answer + numbered sponsor sources.
7. Open **Catalogue** → search `SerpApi` / `You.com` → two installable agent presets.
8. Open **Workspaces → LiveDesk** → 7-agent team + 5-step pipeline + **10-record Research Queue** dataset. Point at `Live Web Researcher`, `Live Topic Monitor`, `Live SEO Auditor`: *"The same sponsor APIs power normal agents too."*
9. Close with: *"One question; fresh structured signals; a cited answer; and a repeatable workflow. That's LiveDesk inside LayerFlow."*

Suggested live queries if the preset is slow:
- `What changed in AI agent pricing this week?`
- `Agentic AI hackathons in India 2026`
- `SerpApi vs You.com for live research agents`

---

## 9. Business model (how this makes money)

### Who pays
| Customer | Pain they pay to remove | Our hook |
| --- | --- | --- |
| Newsrooms / publishers | Hours of research, fact-checking, repurposing | LiveDesk cited research + newsroom pipelines |
| Founders / VC analysts | Tracking markets daily without a research team | Fresh signals + cited brief on a schedule |
| Colleges / course teams | Admissions, events, FAQ research repeated every month | Workspace + assistant over their own datasets |
| Agencies / SMBs | SEO audits, content, publishing, lead research | Agent presets + SEO auditor with live SERP context |

### Revenue
- **SaaS subscription** per workspace with plan limits (enforced in code today).

| Plan | ₹/month | Agents | Runs/day | Records | API calls/day | Members |
| --- | --- | --- | --- | --- | --- | --- |
| Free | 0 | 5 | 50 | 1,000 | 500 | 3 |
| Starter | 1,999 | 15 | 300 | 10,000 | 5,000 | 5 |
| Pro | 4,999 | 40 | 1,500 | 100,000 | 50,000 | 15 |
| Business | 14,999 | 150 | 10,000 | 1,000,000 | 500,000 | 50 |
| Enterprise | custom | unlimited | unlimited | unlimited | unlimited | unlimited |

- **Setup + workflow fee** for onboarding (workspace, agents, first pipeline tuned to client data).
- **Usage margin** on sponsor credits: clients bring keys or buy credits through us; caching + one-call-per-run keeps COGS predictable.
- **Self-hosted option** on one VPS with open-weight models — no per-token model bill, which is the strongest cost argument against generic chatbot tools.

**Honest line to say before they ask:** *"Plans and limits are enforced in code; the payment checkout is not wired yet — connecting Razorpay/Stripe to the existing plan action is a short integration. We are showing the product and the pricing model, not pretending billing is live."*

---

## 10. Judging criteria — evidence map

| Criterion | What to point at |
| --- | --- |
| Working prototype / demo (30%) | `/livedesk` page, demo mode, seeded 7-agent workspace + 10-record dataset, 148 passing backend tests, typecheck and production build clean |
| Sponsor integration (25%) | 6 SerpApi engines + Extract, You.com Search + Answer, 4 sponsor tools, 2 sponsor agent kinds, 3 ordinary agents using sponsor data, parallel `/livedesk/research` endpoint, cited assistant |
| Real-world problem / impact (20%) | Fresh, verifiable answers for desks/students/founders; no tab switching; same research becomes a dataset, run log, report and assistant answer |
| Innovation / originality (15%) | Parallel sponsor fan-out normalized into one evidence model; sponsor data becomes reusable agent capability via one config toggle; citation-aware assistant reuses the same evidence |

---

## 11. Verified evidence (checked today, 22 Nov)

- `python3 -m pytest -q` in `apps/api` → **148 passed**.
- `pnpm typecheck` in `apps/web` → clean.
- `pnpm build` → succeeds (Next.js prints a security-upgrade advisory; retry continues the build).
- Live keys are configured in `apps/api/.env`; `.env` is gitignored, only `.env.example` is committed.
- Repo pushed to `https://github.com/Rohit94r/Buildthon-paytm.git`, branch `main`, working tree clean.

---

## 12. Judge Q&A — keep these answers ready

| Question | Answer |
| --- | --- |
| "Why two tracks? Isn't one enough?" | "One gets you data or a narrative. Research needs both: SerpApi gives structured, comparable facts; You.com gives a cited synthesis. We made them complementary in one response, not two separate demos." |
| "Is this just a UI over two APIs?" | "No. The sponsor calls are tools and agent kinds inside a platform with 26 kinds, 50 presets, pipelines, datasets, permissions, run logs and an assistant. Ordinary agents opt into live evidence with one config flag." |
| "Are these real API calls or fake data?" | "Real endpoints with real request shapes. With no key or a network failure, we fall back to clearly labelled sample data (`provider='demo'`, sample badge). Judges can watch the network tab." |
| "What stops this burning all our credits?" | "5-minute cache, one You.com answer call per research run, reuse of the answer's own results for evidence, 12 s timeouts, and mocked HTTP in tests. Failed calls are not cached, so retries are cheap and correct." |
| "How do you handle wrong or hallucinated sources?" | "Citations come as structured API data with real URLs; we render them verbatim. The assistant is told to cite `[n]` markers and the source list is appended even if the model paraphrases. Comparison numbers are computed from dataset fields, never generated." |
| "What if one sponsor is down?" | "Per-call degradation and a `degraded` flag on the response and per collection. The other sponsor still works; nothing is silently presented as live." |
| "Is the business model real?" | "Plans and entitlements are enforced in code; checkout is the remaining short integration. We are honest about that instead of faking billing." |
| "Can we use our own keys / self-host?" | "Yes — keys are read server-side with aliases, `.env.example` documents every variable, and the whole stack is Docker Compose based." |

---

## 13. Setup (for a judge who wants to run it)

```bash
git clone https://github.com/Rohit94r/Buildthon-paytm.git && cd Buildthon-paytm
cp .env.example apps/api/.env       # add SERPAPI_API_KEY / YOUCOM_API_KEY (aliases accepted)
cd apps/api && python3 -m pip install -e ".[dev]" && python3 -m app.cli migrate && python3 -m app.cli seed-demo-platform
python3 -m uvicorn app.main:app --reload --port 8000
# second terminal
cd apps/web && pnpm install && pnpm dev
```

No keys or no backend? `NEXT_PUBLIC_DEMO_MODE=true pnpm dev` renders the same screens with labelled sample data.

**Bonus SerpApi credits:** [Mumbai](https://serpapi.com/beyond9to5mumbai500) · [Bengaluru](https://serpapi.com/beyond9to5blr)

**Safety:** the keys were once pasted in a chat — rotate them after the event; never commit `.env`.

---

## 14. Pocket lines (Hinglish, for confidence)

- *"Ek sawaal, do sponsors, ek response — aur poora platform us evidence ka use karta hai."*
- *"SerpApi structure deta hai, You.com citation. Dono milke answer ko verify karne layak banate hain."*
- *"LiveDesk alag product nahi — LayerFlow ka research desk hai, aur ye agents platform ke hi agents hain."*
- *"Agar key na ho to sample data dikhte hain, clearly labelled. Hum kabhi fake ko live nahi bolte."*

**Bottom line:** *LiveDesk is a working research desk inside one agent platform. Two sponsor tracks, used properly and used together — that is the demo.*
