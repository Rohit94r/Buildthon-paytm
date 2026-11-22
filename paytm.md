# Beyond 9TO5 Buildathon — Professional Pitch Deck
## LayerFlow (Aentazo / Agentsy) · **LiveDesk**, the research desk inside the platform

> **One product. One platform. Two sponsor tracks — SerpApi + You.com.**
> Repo: `Rohit94r/Buildthon-paytm` · Branch: `main` · Event: Beyond 9TO5 Buildathon

---

## Slide 0 — How to position this (read before you go on stage)

**Say this, never anything else:**

> "I built **one agent platform** — LayerFlow, which I present as **Aentazo / Agentsy**. **LiveDesk is a research desk inside that same platform**, like the newsroom desk or the SEO desk. These are the platform's own agents, its own datasets, its own run logs. I did not build two apps and stick them together."

- **LayerFlow / Aentazo / Agentsy** = the full multi-tenant agent platform (FastAPI + Next.js, 26 agent kinds, 50 presets, pipelines, datasets, assistant, public API, SDKs).
- **LiveDesk** = one desk/workspace inside it for live, cited research.
- **SerpApi + You.com** = platform capabilities, not demo decorations. They are agent kinds, tools, and opt-in live evidence for ordinary agents.

**Track strategy, out loud:**
> "Most teams pick one sponsor and go deep. We picked both because research needs two things: **structured evidence** and a **cited answer**. We made them complementary in one flow — that's the product, not two separate integrations."

**Do not say:** "LiveDesk is built on top of a different platform", "these are two different products", "we used Nexconn/Track 3".

---

## Slide 1 — Title

### **LiveDesk inside LayerFlow**
### *One question → fresh evidence → a cited answer → a reusable agent workflow*

**Subtitle:** An agent platform where SerpApi and You.com are not logos on a slide — they are tools every agent can call.

**Say (10 seconds):**
> "I'm Rohit. I built an agent platform called LayerFlow — Aentazo / Agentsy — and LiveDesk is its research desk. Today I'll show you one question becoming a verifiable brief, and how the same evidence powers the rest of the platform."

---

## Slide 2 — The one-line pitch

> **LiveDesk turns one question into a verifiable research brief: SerpApi collects fresh structured signals, You.com writes a cited answer, and the same evidence grounds the platform's datasets, run logs and assistant.**

**30-second version:**
> "Ask a question. SerpApi fans out to Web, News, Jobs, Shopping, Maps and Scholar in parallel. You.com answers the same question with numbered sources. Both come back in one response, on one screen, with links you can open. The result is saved as an agent run and a dataset record, so the assistant can keep citing live sources on follow-ups. It's a research desk inside a working agent platform — not a chatbot with links."

---

## Slide 3 — Problem: why people still copy-paste from five tabs

Students, founders, analysts and news desks need answers that are **fresh** and **checkable**. Today they get:

1. **Stale data** — a model's training cutoff, not today's web.
2. **No citations** — a confident sentence with no way to verify it.
3. **Tab switching** — five searches, five sites, manual copy-paste.
4. **No structure** — search results are HTML noise, not comparable rows.
5. **No workflow** — the output cannot become a dataset, a scheduled run, a report or a team process.

**Say:**
> "The real problem isn't 'I need search'. Search exists. The problem is that **AI answers and real-time evidence live in different tools**. Search gives links without synthesis; chatbots give synthesis without fresh links; neither gives you a reusable workflow."

---

## Slide 4 — Insight & solution shape

```
        ONE QUESTION
              │
              ▼
   POST /api/v1/livedesk/research
              │
   ┌──────────┴───────────┐
   ▼                      ▼
SerpApi (6 engines)    You.com (Answer API)
structured hits        cited narrative + sources
   └──────────┬───────────┘
              ▼
   ONE EVIDENCE RESPONSE
   answer · numbered sources · per-engine cards · degraded flag
              ▼
   saved as:  pipeline run → dataset record → activity event → audit
              ▼
   assistant follow-ups reuse the same live evidence
```

**Say:**
> "The insight is simple: don't choose between search and synthesis — normalize both into one evidence model, then make that model a first-class citizen of the agent platform."

---

## Slide 5 — Product: one platform, many desks

| Layer | What exists today |
| --- | --- |
| Agent runtime | 26 agent kinds, 50 catalogue presets, tool registry, retries/timeouts, run logs, approvals, cancel/retry |
| Pipelines | Sequential steps, schedules, manual trigger, versioned configs, per-step events |
| Datasets | Typed fields, upsert by key, comparison tables computed (never generated), assistant over any dataset |
| Workspaces | Multi-tenant roles/permissions, members, plan limits enforced in code, audit + activity feed |
| Delivery | Connections for CMS/social/webhook, signed webhooks, scoped public API keys, TS/Python SDKs |
| **Desks** | Newsroom, College, Hackathon, SEO — and **LiveDesk**, the cited research desk |

**Say:**
> "LiveDesk is one desk in this platform. It uses the same agents, permissions, pipelines and datasets as every other desk. That's why the judges are seeing a product, not a wrapper."

---

## Slide 6 — The LiveDesk screen

- Header pill: **"Sponsor keys connected"** — or honestly **"Demo mode · sample data"**.
- Question box + presets, e.g. *"AI agent startup funding in India this month"*.
- Six engine toggles: **Web / News / Jobs / Shopping / Maps / Scholar**; location + result count (3/5/8/10).
- **Run research** → parallel sponsor calls (~3–5 s observed).
- **You.com cited answer** panel with clickable `[n]` sources.
- **SerpApi structured cards** with title, snippet, publisher, date, live URL.
- **"saved as run"** badge → opens the real pipeline run with 5 agent steps.
- **Follow-up assistant** with *live sources on*, reading the saved research record.

**Say:**
> "Everything on this screen is real state. The answer is from You.com, the cards are from SerpApi, the run is a real row in `pipeline_runs`, and the follow-up assistant reads the record we just saved."

---

## Slide 7 — ⭐ Why BOTH sponsors? (the slide they will ask about)

| Need | **SerpApi** | **You.com** |
| --- | --- | --- |
| What it gives | **Structured facts**: 6 engines, positions, prices, dates, ratings, places, links | **Synthesized answer** with inline `[n]` citations |
| Strength | Machine-readable, filterable, comparable — perfect for tables | Readable narrative; every claim attached to a source |
| Alone | Lots of results, no answer | One answer, less structured comparison data |
| **Main use in our product** | **The evidence pipeline** — collect and normalize fresh signals for datasets, comparisons, audits and agents | **The cited narrator** — write the brief and ground the assistant with verifiable sources |
| Business value | "What exactly changed, and where?" | "What does it mean, and how do I verify it?" |

### The answer to "what use Serper / what's the main use in your product?"

> **"SerpApi is the evidence pipeline. You.com is the cited narrator. Together they give fresh data *and* a verifiable answer — neither alone does both. The main use in Aentazo/Agentsy is grounding every agent in fresh, checkable evidence, so briefs, comparisons and reports can be trusted and traced."**

**Say:**
> "If a judge asks 'why two tracks?', I say: one gets you data or a narrative; research needs both. We didn't run two demos — we ran one flow with two complementary sponsors."

---

## Slide 8 — SerpApi: exact technical use (Track 1)

**Files:** `apps/api/app/services/sponsor.py` · `app/platform/kinds/serpapi_search.py` · tools `serpapi.search`, `serpapi.extract`

- `GET https://serpapi.com/search.json?engine=...&q=...&api_key=...&gl=in&hl=en&num=...`
- One `SearchHit` shape across all native buckets:

| Engine | Native bucket | We normalize |
| --- | --- | --- |
| `google` | `organic_results` | title, snippet, link, source, date |
| `google_news` | `news_results` | headline, publisher, date |
| `google_jobs` | `jobs_results` | role, company, location, apply link |
| `google_shopping` | `shopping_results` | product, price, seller |
| `google_maps` | `local_results` | place, address, rating |
| `google_scholar` | `organic_results` | paper, publication info |

- `/extract?...&output=md` → full page markdown; `extract_top` deepens an agent's top N hits.
- Multi-query fan-out, URL de-duplication, `ctx.outputs["report"]` + FlowItems with engine/source.
- Keys server-side only (`SERPAPI_API_KEY`, alias `SERPAPI_KEY`); never in requests, cache keys, logs or responses.

**Say:**
> "SerpApi is how we get machine-readable reality — comparable rows, not pretty HTML. That's what makes it useful inside agents and datasets, not just on a demo page."

---

## Slide 9 — You.com: exact technical use (Track 2)

**Files:** same service module · `app/platform/kinds/you_research.py` · tools `you.search`, `you.answer`

- `POST https://api.you.com/v1/search` with `X-API-Key` → `results.web[]` normalized to hits.
- `POST https://api.you.com/v1/answer` → `answer`, `citations[]`, `results.web[]` → `CitedAnswer`.
- Client also tries `ydc-index.io` for scoped keys; `YDC_API_KEY` alias supported.
- `you_research` has **answer** mode (cited narrative) and **search** mode (cited brief).
- `cited_evidence()` gives the assistant numbered evidence; You.com search first, SerpApi News second.
- If an answer has web results but no inline citations, we promote those result URLs to links — no answer goes unsourced.

**Say:**
> "You.com is how the raw evidence becomes something a human can read — with citations that came as structured API data, not from a model remembering URLs."

---

## Slide 10 — ⭐ Sponsors become platform capabilities (the real USP)

Live evidence is **not trapped in the demo page**. Any agent opts in with `live_sources: true`:

| Agent kind | What the sponsor API does for it |
| --- | --- |
| `comparison_assistant` | Live sources toggle → cited evidence on any dataset question |
| `researcher` (Research Analyst) | SerpApi results become candidate sources; You.com answer appended with citations |
| `news_monitor` (News Monitor) | SerpApi `google_news` becomes real-time items alongside/instead of RSS |
| `site_auditor` (SEO Auditor) | SerpApi discovers pages the sitemap misses; You.com adds cited live context |
| `serpapi_search`, `you_research` | Dedicated installable sponsor agent kinds in the catalogue |

All calls go through `invoke(ctx, "serpapi.search" | "you.search" | "you.answer")` → tool events, allowlists, timeouts.

**Seeded LiveDesk desk:** 7 agents · 5-step pipeline
`Web Signal Collector → News Signal Monitor → Live Web Researcher → Live SEO Auditor → Cited Answer Desk` · 10 clearly-labelled sample research questions (real runs replace their row with live evidence).

**Say:**
> "This is the difference between an integration and a capability. A sponsor API becomes an agent, a tool, a dataset row, a run log, a report and an assistant answer — with one config flag."

---

## Slide 11 — End-to-end: research becomes workflow (new)

A real LiveDesk run now writes:

1. **PipelineRun** — `status=succeeded`, the 5 desk agents as steps, real input (question, engines, location), `items_out` = hits + sources.
2. **DatasetRecord** — the question's row in `research_queue` is upserted with the live answer, provider, engines, citation URLs, hits, latency and run id.
3. **ExecutionEvents** — `step.finished` ×5 and `run.finished` (same events the normal runtime writes) → Activity feed + SSE.
4. **AuditLog** — `livedesk.research` with redacted detail.
5. **Assistant** — follow-up questions read that record *and* call both sponsors again for fresh context.

**Say:**
> "A paid-for API call is never thrown away. It becomes state the rest of the platform can use — that's what 'end-to-end' means here."

---

## Slide 12 — USP / differentiation

1. **Two sponsor tracks, one flow.** Structured evidence + cited synthesis in one response and one story.
2. **Sponsors as platform capabilities.** Four sponsor tools, two agent kinds, three ordinary agents opting in with one toggle.
3. **Citations by construction.** Sources are structured API data rendered with links — not a model hallucinating URLs.
4. **Credit-aware and honest.** 5-minute cache, one answer call per run, reuse of answer results, 12 s timeouts, failed calls never cached, sample data labelled.
5. **Real product underneath.** 148 passing backend tests, clean typecheck, production build works.

**Say:**
> "Other teams show an API call. We show an API call that changes the state of a product."

---

## Slide 13 — Verification / evidence (checked on stage day)

- **Live sponsor call:** `keys {serpapi:true, youcom:true}`, `degraded:false`, `answer.provider:"you.com"`, SerpApi collections `provider:"serpapi"` (Web + News), live URLs opened.
- **Persistence verified:** run `succeeded` with 5 agent steps, 6 hits, `step.finished` ×5 + `run.finished`, research row `status=answered`, audit `livedesk.research`.
- `python3 -m pytest -q` → **148 passed**
- `pnpm typecheck` → clean
- `pnpm build` → succeeds (Next.js prints an advisory on first run; retry continues).
- Keys are in `apps/api/.env` only; `.env` is gitignored; `.env.example` documents every variable.
- Repo pushed to `origin/main`; working tree clean.

**Say:**
> "I'm not asking you to trust a screenshot. The keys are connected, the response is live, the run is in the database, and the test suite passes."

---

## Slide 14 — Business model

### Who pays

| Customer | Pain removed | Hook |
| --- | --- | --- |
| Newsrooms / publishers | Hours of research, fact-checking, repurposing | Cited research + newsroom pipelines |
| Founders / VC analysts | Daily market tracking without a research team | Fresh signals + cited brief on a schedule |
| Colleges / course teams | Repeated admissions/events/FAQ research | Workspace + assistant over their datasets |
| Agencies / SMBs | SEO audits, content, publishing, lead research | Presets + auditor with live SERP context |

### Revenue

- **SaaS subscription** per workspace with plan limits enforced in code today.

| Plan | ₹/month | Agents | Runs/day | Records | API calls/day | Members |
| --- | --- | --- | --- | --- | --- | --- |
| Free | 0 | 5 | 50 | 1,000 | 500 | 3 |
| Starter | 1,999 | 15 | 300 | 10,000 | 5,000 | 5 |
| Pro | 4,999 | 40 | 1,500 | 100,000 | 50,000 | 15 |
| Business | 14,999 | 150 | 10,000 | 1,000,000 | 500,000 | 50 |
| Enterprise | custom | unlimited | unlimited | unlimited | unlimited | unlimited |

- Setup + workflow fee; usage margin on sponsor credits (or clients bring keys); self-hosted option with open-weight models.

**Honest line:**
> "Plans and limits are enforced in code; the checkout is a short Razorpay/Stripe integration away. I'm showing the product and the model, not pretending billing is live."

---

## Slide 15 — 90-second live demo (do exactly this)

| Time | Action | Say |
| --- | --- | --- |
| 0:00 | Open `/livedesk`, point at **Sponsor keys connected** | "Both keys are live, server-side." |
| 0:08 | Preset *"AI agent startup funding in India this month"*, toggle **Web + News**, 5 results | "Two SerpApi engines, one You.com answer, in parallel." |
| 0:16 | **Run research** | "Both sponsors are being called now — watch the answer and the cards arrive together." |
| 0:30 | Click a numbered source | "Real URL, from the API's structured citations." |
| 0:38 | Show SerpApi cards | "Publisher, date, snippet, link — machine-readable evidence. Jobs, Shopping, Maps, Scholar are one toggle away." |
| 0:48 | Click **saved as run** | "This is a real pipeline run with five agent steps — not a throwaway response." |
| 0:58 | **Follow-up assistant**, *live sources on*: "What should we research first about AI agents in India?" | "The assistant reads the saved record and re-cites both sponsors." |
| 1:12 | **Catalogue** → search `SerpApi`, `You.com` | "Two installable agent kinds in the same catalogue as every other agent." |
| 1:24 | **Workspaces → LiveDesk** → 7 agents, 5-step pipeline, Research Queue | "The same APIs power ordinary agents too — one `live_sources` flag." |
| 1:36 | Close | "One question; fresh structured signals; a cited answer; a repeatable workflow. That's LiveDesk inside LayerFlow." |

Fallback queries if the preset is slow: `What changed in AI agent pricing this week?` · `Agentic AI hackathons in India 2026` · `SerpApi vs You.com for live research agents`.

---

## Slide 16 — Judge Q&A (keep these ready)

| Question | Answer |
| --- | --- |
| **"What does SerpApi actually do in your product?"** | "It's the evidence pipeline: six structured engines plus page extract. It gives our agents comparable facts — titles, snippets, dates, prices, ratings, places — that become dataset rows and audit-able sources." |
| **"What does You.com actually do?"** | "It's the cited narrator: the Answer API returns a readable brief plus numbered citations and web results. Our desk renders those as clickable sources and feeds them to the assistant." |
| **"Then what is the *main* use in Aentazo/Agentsy?"** | "Grounding every agent in fresh, verifiable evidence. The sponsors are not the product; **trustworthy agent output** is the product. SerpApi supplies the evidence, You.com makes it readable and checkable." |
| "Why two tracks? Isn't one enough?" | "One gives data or narrative. Research needs both. We combined them in one normalized response, not two separate demos." |
| "Is this just a UI over two APIs?" | "No. Sponsor calls are tools and agent kinds inside a platform with 26 kinds, 50 presets, pipelines, datasets, permissions, run logs and an assistant. Ordinary agents opt in with one config flag." |
| "Real calls or fake data?" | "Real endpoints, real request shapes, real responses. With no key or a network failure we fall back to clearly labelled sample data (`provider='demo'`, sample badge). Watch the network tab." |
| "What about credits?" | "Five-minute cache, one You.com answer per run, reuse of the answer's own results, 12 s timeouts, mocked HTTP in tests. Failed calls are never cached, so retries recover immediately." |
| "What if one sponsor is down?" | "Per-call degradation, `degraded` flags on the response and each collection. The other sponsor still works; nothing is silently presented as live." |
| "How do you stop hallucinated sources?" | "Citations are structured API data with real URLs, rendered verbatim. The source list is appended even if the model paraphrases. Comparison numbers are computed from dataset fields, never generated." |
| "Is the business model real?" | "Plans and entitlements are enforced in code; checkout is the remaining short integration. Honest over fake." |
| "Can we use our keys / self-host?" | "Yes — keys are read server-side with aliases, `.env.example` documents every variable, stack is Docker Compose based, and a separate DB schema keeps our tables isolated on a shared Postgres." |
| "Why the name Aentazo / Agentsy / LayerFlow?" | "One agent system: LayerFlow is the platform name in the repo, Aentazo / Agentsy is how I present the agent product on stage. LiveDesk is a desk inside it — never a second app." |

---

## Slide 17 — Closing

> **"Ek sawaal, do sponsors, ek response — aur poora platform us evidence ka use karta hai."**
> *(One question, two sponsors, one response — and the whole platform uses that evidence.)*

- *"SerpApi structure deta hai, You.com citation. Dono milke answer ko verify karne layak banate hain."*
- *"LiveDesk alag product nahi — LayerFlow ka research desk hai, aur ye agents platform ke hi agents hain."*
- *"Agar key na ho to sample data dikhte hain, clearly labelled. Hum kabhi fake ko live nahi bolte."*

**Final line:**
> **LiveDesk is a working research desk inside one agent platform. Two sponsor tracks, used properly and used together — that's the demo.**

---

## Appendix A — Setup for a judge

```bash
git clone https://github.com/Rohit94r/Buildthon-paytm.git && cd Buildthon-paytm
cp .env.example apps/api/.env      # add SERPAPI_API_KEY / YOUCOM_API_KEY (aliases accepted)
# shared Postgres? set DB_SCHEMA=buildthon (or any schema) to isolate tables
cd apps/api && python3 -m pip install -e ".[dev]" && python3 -m app.cli migrate && python3 -m app.cli seed-demo-platform
python3 -m uvicorn app.main:app --reload --port 8000
# second terminal
cd apps/web && pnpm install && pnpm dev
```

No keys or no backend? `NEXT_PUBLIC_DEMO_MODE=true pnpm dev` renders the same screens with labelled sample data.

**Bonus SerpApi credits:** [Mumbai](https://serpapi.com/beyond9to5mumbai500) · [Bengaluru](https://serpapi.com/beyond9to5blr)

**Safety:** the keys were once pasted in a chat — rotate them after the event; never commit `.env`.

## Appendix B — Reliability, cost, honesty

| Concern | Handling |
| --- | --- |
| Missing key | Sample results with `provider="demo"` + **sample** badge; never claimed live |
| Network error / 401 / quota | Caught per call; failures never cached, so a retry recovers |
| Sponsor slowdown | 12 s client timeout, 15 s tool timeout, parallel fan-out |
| Repeated runs | 5-minute in-process cache keyed by query/engine/count; key excluded from key + logs |
| Partial outage | `degraded: true` at response, answer and collection level |
| Credit safety | One You.com answer call per run; answer results reused; tests mock HTTP |
