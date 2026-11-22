# LayerFlow LiveDesk

**Beyond 9TO5 Buildathon — SerpApi + You.com tracks.**

LiveDesk turns one question into a verifiable research brief: **SerpApi** collects structured, real-time signals
from Google Web, News, Jobs, Shopping, Maps and Scholar; **You.com** answers the same question with inline
citations and live web results. Both calls run in parallel, and every result is normalized into one workspace UI.

LiveDesk is a research desk **inside LayerFlow**, one working multi-tenant agent platform (FastAPI + Next.js) with
26 agent kinds, 50 catalogue presets, pipelines, datasets, runs, assistant chat, public API and SDKs. Sponsor calls
are platform tools and agents — not a separate app: ordinary agents (Research Analyst, News Monitor, SEO Auditor)
also consume SerpApi and You.com data with one config toggle.

| | |
| --- | --- |
| **Fastest demo (no keys, no backend)** | `cd apps/web && pnpm install && NEXT_PUBLIC_DEMO_MODE=true pnpm dev` → http://localhost:3000/livedesk |
| **Full demo (live sponsor APIs)** | Add keys to `apps/api/.env`, run the API, then open `/livedesk` · [local dev](docs/setup/local-dev.md) |
| **Hackathon story + demo script** | [HACKATHON.md](HACKATHON.md) |
| **Hinglish explainer** | [paytm.md](paytm.md) |
| **Product docs** | [Platform overview](docs/product/PLATFORM.md) · [Agent catalogue](docs/product/agents.md) · [API](docs/platform/API.md) |

## What LiveDesk does

```
                         ┌────────────────────────── SerpApi ──────────────────────────┐
                         │ google · news · jobs · shopping · maps · scholar · extract │
Question ──► /livedesk/research ─┤                                                       ├──► one cited brief
                         └──────────────────── You.com Answer + Web Search ────────────┘
                                                        │
                                                        ▼
                          Assistant "Live sources" toggle + comparison table + citations
```

- **Sponsor agents, not wrappers.** `serpapi_search` and `you_research` are first-class platform agent kinds with
  catalogue presets, config forms, tools, tests and run-log output. Researcher, News Monitor and SEO Auditor can opt
  into the same live evidence. The seeded **LiveDesk** workspace ships a seven-agent team, a five-step manual pipeline
  and a 10-record research dataset.
- **Cited by construction.** You.com citations are returned as structured sources; the assistant also renders an
  explicit numbered source list even if the model paraphrases away its `[n]` markers.
- **Saved as platform state.** Each research run writes a real pipeline run (5 steps, step events, audit entry),
  upserts the cited answer into the Research Queue dataset and feeds the LiveDesk follow-up assistant.
- **Fast and credit-aware.** 12s timeouts, 5-minute in-process cache, one You.com answer call per research run, and
  injected transports in tests — no credits are spent by the test suite.
- **Honest fallback.** With no key or a failed request, results are deterministic and labelled `provider="demo"` /
  "sample" in the UI. Judges can run the demo before any keys are configured.

## Hackathon mapping

| Criterion | What is in this repo |
| --- | --- |
| Working prototype / demo (30%) | `/livedesk` dashboard, seeded LiveDesk workspace (7 agents, 10 sample records), frontend demo mode, 148 passing backend tests, typecheck + production build |
| Sponsor / track integration (25%) | Real SerpApi `search.json` + `/extract` clients; real You.com `/v1/search` + `/v1/answer` clients; four sponsor tools; two sponsor agent kinds; two catalogue presets; three ordinary agents wired to live evidence |
| Real-world problem / impact (20%) | Researchers and desks need fresh answers with sources, not stale model recall; LiveDesk removes tab-switching and makes every claim traceable |
| Innovation / originality (15%) | One parallel research endpoint feeds the whole platform; the same sponsor evidence grounds the assistant, the researcher, the news monitor and the SEO auditor via one config toggle |

## Try it

### 1. Frontend-only demo

No backend, no keys, no Ollama. Sample results are clearly labelled.

```bash
cd apps/web
pnpm install
NEXT_PUBLIC_DEMO_MODE=true pnpm dev
```

Open **http://localhost:3000/livedesk**, pick preset engines and press **Run research**.

### 2. Live sponsor APIs

```bash
cp .env.example apps/api/.env
# Fill SERPAPI_API_KEY (or SERPAPI_KEY) and YOUCOM_API_KEY (or YDC_API_KEY) in apps/api/.env
# On a shared Postgres/Neon, set DB_SCHEMA=buildthon in apps/api/.env to isolate this product's tables.
cd apps/api
python -m pip install -e ".[dev]"
python -m app.cli migrate
python -m app.cli seed-demo-platform
python -m uvicorn app.main:app --reload --port 8000
```

In another terminal:

```bash
cd apps/web
pnpm install
pnpm dev
```

Open http://localhost:3000/livedesk. The status pill at the top says **Sponsor keys connected** when both keys are
present. `SERPAPI_KEY` is accepted as an alias for `SERPAPI_API_KEY`, and `YDC_API_KEY` as an alias for
`YOUCOM_API_KEY`.

> Extra SerpApi credits for this buildathon:
> [Mumbai](https://serpapi.com/beyond9to5mumbai500) · [Bengaluru](https://serpapi.com/beyond9to5blr)

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/livedesk/status` | Key configuration + available SerpApi engines (never returns key material) |
| `POST` | `/api/v1/livedesk/research` | Parallel research run: `{ query, engines, location, count }` → answer, citations and per-engine collections |
| `POST` | `/api/v1/assistant/chat` | Dataset Q&A; set `"live_sources": true` to add cited web grounding |
| `GET/POST` | `/api/v1/agents`, `/api/v1/pipelines`, `/api/v1/datasets` | Platform APIs used by the LiveDesk workspace (agents, pipelines, datasets) |

## Repository map

```
apps/api/app/services/sponsor.py            SerpApi + You.com clients, normalization, cache, fallback
apps/api/app/platform/routers/sponsor.py    /livedesk/status + /livedesk/research
apps/api/app/platform/kinds/                serpapi_search.py, you_research.py, live_evidence.py
                                            (plus researcher / news_monitor / site_auditor live wiring)
apps/api/app/platform/assistant.py          citation-aware chat (live_sources)
apps/api/app/platform/blueprints.py         livedesk_research blueprint
apps/api/app/platform/seed.py               LiveDesk demo workspace + sample question queue
apps/web/app/(app)/livedesk/page.tsx        LiveDesk dashboard
apps/web/lib/demo/                          frontend-only sponsor demo handlers
HACKATHON.md                                demo script, architecture and judging notes
```

Full product docs (setup, deployment, integrations, ops) are in [`docs/`](docs/README.md); the stage-ready pitch is in [`paytm.md`](paytm.md).

## Verification

```bash
cd apps/api && python3 -m pytest -q          # 148 passed
cd apps/web && pnpm typecheck && pnpm build   # clean
```

Backend tests mock the HTTP transport, so they run offline and spend no sponsor credits.

## License

Hackathon build. Underlying LayerFlow project: private / all rights reserved.
