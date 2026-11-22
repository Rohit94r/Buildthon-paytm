# LayerFlow LiveDesk

**Beyond 9TO5 Buildathon — SerpApi + You.com tracks.**

LiveDesk turns one question into a verifiable research brief: **SerpApi** collects structured, real-time signals
from Google Web, News, Jobs, Shopping, Maps and Scholar; **You.com** answers the same question with inline
citations and live web results. Both calls run in parallel, and every result is normalized into one workspace UI.

It is built on **LayerFlow**, a working multi-tenant agent platform (FastAPI + Next.js) with 26 agent kinds,
pipelines, datasets, runs, assistant chat, public API and SDKs. This repo keeps that platform intact and adds the
sponsor integrations, a seeded demo workspace and a dedicated dashboard as hackathon work.

| | |
| --- | --- |
| **Fastest demo (no keys, no backend)** | `cd apps/web && pnpm install && NEXT_PUBLIC_DEMO_MODE=true pnpm dev` → http://localhost:3000/livedesk |
| **Full demo (live sponsor APIs)** | Add keys to `apps/api/.env`, run the API, then open `/livedesk` · [local dev](docs/setup/local-dev.md) |
| **Hackathon story + demo script** | [HACKATHON.md](HACKATHON.md) |
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
  catalog presets, config forms, tools, tests, and run-log output. A seeded **LiveDesk** workspace ships a four-agent
  team and a manual pipeline.
- **Cited by construction.** You.com citations are returned as structured sources; the assistant also renders an
  explicit numbered source list even if the model paraphrases away its `[n]` markers.
- **Fast and credit-aware.** 12s timeouts, 5-minute in-process cache, one You.com answer call per research run, and
  injected transports in tests — no credits are spent by the test suite.
- **Honest fallback.** With no key or a failed request, results are deterministic and labelled `provider="demo"` /
  "sample" in the UI. Judges can run the demo before any keys are configured.

## Hackathon mapping

| Criterion | What is in this repo |
| --- | --- |
| Working prototype / demo (30%) | `/livedesk` dashboard, seeded LiveDesk workspace, frontend demo mode, 142 passing backend tests, typecheck + production build |
| Sponsor / track integration (25%) | Real SerpApi `search.json` + `/extract` clients; real You.com `/v1/search` + `/v1/answer` clients; four sponsor tools; two agent kinds; four catalogue presets |
| Real-world problem / impact (20%) | Researchers and desks need fresh answers with sources, not stale model recall; LiveDesk removes tab-switching and makes every claim traceable |
| Innovation / originality (15%) | One parallel research endpoint feeds a general-purpose agent platform; sponsor evidence also grounds the existing comparison assistant via a single toggle |

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
# Fill SERPAPI_API_KEY and YOUCOM_API_KEY in apps/api/.env
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
present. `YDC_API_KEY` is accepted as an alias for `YOUCOM_API_KEY`.

> Extra SerpApi credits for this buildathon:
> [Mumbai](https://serpapi.com/beyond9to5mumbai500) · [Bengaluru](https://serpapi.com/beyond9to5blr)

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/livedesk/status` | Key configuration + available SerpApi engines (never returns key material) |
| `POST` | `/api/v1/livedesk/research` | Parallel research run: `{ query, engines, location, count }` → answer, citations and per-engine collections |
| `POST` | `/api/v1/assistant/chat` | Dataset Q&A; set `"live_sources": true` to add cited web grounding |
| `GET/POST` | `/api/v1/agents`, `/api/v1/pipelines`, `/api/v1/datasets` | Underlying platform APIs used by the seeded LiveDesk workspace |

## Repository map

```
apps/api/app/services/sponsor.py            SerpApi + You.com clients, normalization, cache, fallback
apps/api/app/platform/routers/sponsor.py    /livedesk/status + /livedesk/research
apps/api/app/platform/kinds/                serpapi_search.py, you_research.py
apps/api/app/platform/assistant.py          citation-aware chat (live_sources)
apps/api/app/platform/blueprints.py         livedesk_research blueprint
apps/api/app/platform/seed.py               LiveDesk demo workspace + sample question queue
apps/web/app/(app)/livedesk/page.tsx        LiveDesk dashboard
apps/web/lib/demo/                          frontend-only sponsor demo handlers
HACKATHON.md                                demo script, architecture and judging notes
```

The original platform docs (setup, deployment, integrations, ops) remain in [`docs/`](docs/README.md).

## Verification

```bash
cd apps/api && python3 -m pytest -q          # 142 passed
cd apps/web && pnpm typecheck && pnpm build   # clean
```

Backend tests mock the HTTP transport, so they run offline and spend no sponsor credits.

## License

Hackathon build. Underlying LayerFlow project: private / all rights reserved.
