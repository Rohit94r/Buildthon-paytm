# LiveDesk — buildathon notes

**Tracks:** SerpApi + You.com · **Event:** Beyond 9TO5 Buildathon · **Repo:** `Rohit94r/Buildthon-paytm`

LiveDesk is a live research workspace built on top of the existing LayerFlow agent platform. It answers one question
with **structured SerpApi signals** and a **cited You.com answer** side by side, then lets the user ask follow-ups in
an assistant that can use the same live sources.

---

## 1. The problem

Research desks, students and founders ask questions that need *fresh* web evidence. A normal chatbot answer is usually
uncited, may be stale, and forces the user to open five tabs to verify it. Existing "AI search" tools show an answer
and links, but they do not let a team turn that research into a repeatable workflow with datasets, agents, approvals
and publishing.

LayerFlow already had the workflow layer. LiveDesk adds the missing live-evidence layer:

- SerpApi supplies **machine-readable** results across engines (Web, News, Jobs, Shopping, Maps, Scholar) and can
  deepen a result with the Extract API.
- You.com supplies a **synthesized answer with citations** from live web results.
- The platform turns both into agent items, datasets, run logs and an assistant answer with numbered sources.

---

## 2. 90-second demo script

### Setup (once)

```bash
git clone https://github.com/Rohit94r/Buildthon-paytm.git
cd Buildthon-paytm
cp .env.example apps/api/.env
# add SERPAPI_API_KEY (or SERPAPI_KEY) and YOUCOM_API_KEY (or YDC_API_KEY)
cd apps/api && python -m pip install -e ".[dev]" && python -m app.cli migrate && python -m app.cli seed-demo-platform
python -m uvicorn app.main:app --reload --port 8000
```

Second terminal:

```bash
cd apps/web && pnpm install && pnpm dev
```

> No keys? Skip the API and run `NEXT_PUBLIC_DEMO_MODE=true pnpm dev` in `apps/web`. The same screens render with
> deterministic, clearly-labelled sample results.

### Walkthrough

1. Open **http://localhost:3000/livedesk**. Point to the status pill: `Sponsor keys connected` (or `Demo mode`).
2. Use the preset **"AI agent startup funding in India this month"**.
3. Toggle **Web** and **News** (optionally Jobs/Shopping/Maps/Scholar), set 5 results, press **Run research**.
4. Show the parallel fan-out: two SerpApi collections plus the You.com cited answer come back in one response.
5. Open a citation: it is a real live URL, not a generated one.
6. Switch to **Assistant**, pick the **LiveDesk** workspace / comparison assistant, and turn **Live sources on**.
   Ask: *"What should we research first about AI agents in India?"* — the answer includes numbered sponsor sources.
7. Open **Catalogue** → search `SerpApi` / `You.com`: two new agent kinds and their presets are installable like any
   other LayerFlow agent.
8. Open **Workspaces → LiveDesk** (or run `python -m app.cli seed-demo-platform`) to show the seeded team: Web Signal
   Collector, News Signal Monitor, Cited Answer Desk, Live Research Assistant and a manual pipeline.

### Suggested live queries

- `What changed in AI agent pricing this week?`
- `AI agent startup funding in India this month`
- `Agentic AI hackathons in India 2026`
- `SerpApi vs You.com for live research agents`

---

## 3. How the integrations work

### SerpApi (`apps/api/app/services/sponsor.py`)

- `GET https://serpapi.com/search.json?engine=...&q=...&api_key=...&gl=in&hl=en&num=...`
- Supported engines: `google`, `google_news`, `google_jobs`, `google_shopping`, `google_maps`, `google_scholar`.
- Each engine has a normalizer that maps its native result shape into one `SearchHit`:
  `title · url · summary · source · published_at · position · engine · provider`.
- `serpapi_extract(url)` calls `GET /extract?api_key=...&url=...&output=md` and returns markdown/text with a
  `degraded` flag.
- The `serpapi_search` agent deduplicates by URL and can deepen the top N hits with Extract.

### You.com

- `POST https://api.you.com/v1/search` with `X-API-Key` and `{ query, count }` → `results.web[]` normalized to hits.
- `POST https://api.you.com/v1/answer` → `answer`, `citations[]` and `results.web[]` mapped to `CitedAnswer`.
- The client also tries `https://ydc-index.io` because You.com keys can be scoped to either host.
- `SERPAPI_KEY` is accepted as an alias for `SERPAPI_API_KEY`; `YDC_API_KEY` as an alias for `YOUCOM_API_KEY`.
- The `you_research` agent has two modes: `answer` (cited narrative) and `search` (cited brief built from search hits).

### One endpoint, both sponsors

`POST /api/v1/livedesk/research` uses `asyncio.gather` to run the selected SerpApi engines and the You.com Answer
call concurrently. The response includes:

```json
{
  "query": "...",
  "answer": { "answer": "... [[1]]", "citations": [...], "results": [...], "provider": "you.com", "degraded": false },
  "collections": [{ "engine": "google", "label": "Web", "hits": [...], "degraded": false }],
  "evidence": "[1] Title — excerpt (url)",
  "sources": [{ "number": 1, "title": "...", "source": "https://...", "excerpt": "..." }],
  "keys": { "serpapi": true, "youcom": true },
  "degraded": false,
  "latency_ms": 831
}
```

The answer's own web results are reused for the evidence block, so a research run makes **one** You.com answer call.

### Citation-aware assistant

`POST /api/v1/assistant/chat` accepts `"live_sources": true`. It calls `cited_evidence()` (You.com search first,
SerpApi News as a second source), adds the numbered evidence to the model prompt, and always returns a `sources[]`
array plus a rendered source list. A comparison assistant can also set `live_sources: true` in its saved config.

---

## 4. Reliability, cost and honesty

| Concern | Handling |
| --- | --- |
| Missing key | Returns deterministic sample hits with `provider="demo"`; UI shows a **sample** badge and status pill. |
| Network failure / 401 / quota error | Caught per call; falls back to labelled demo data instead of failing the request. |
| Slow sponsor | 12-second timeout per call; parallel fan-out keeps total latency close to the slowest single call. |
| Repeated demo runs | 5-minute in-process TTL cache keyed by query/engine/count; the API key is never part of the cache key. |
| Test cost | `set_transport(httpx.MockTransport(...))` injects a fake HTTP layer; the full suite spends zero credits. |
| Secret leakage | Keys are read from server settings only, never from request bodies, and are excluded from cache keys and responses. |

---

## 5. Judging criteria — evidence

| Criterion | Evidence in this repo |
| --- | --- |
| **Working prototype / demo (30%)** | `/livedesk` page, frontend demo mode, seeded LiveDesk workspace, 142 backend tests, `pnpm typecheck` + `pnpm build` clean, committed demo script above. |
| **Sponsor / track integration (25%)** | Real request shapes for 6 SerpApi engines + Extract and You.com Search + Answer; 2 agent kinds, 4 sponsor tools, 4 catalogue presets, a research endpoint and a cited-assistant mode. |
| **Real-world problem / impact (20%)** | Fresh, verifiable research for desks/students/founders; no tab-switching, every claim linked to its source; existing workflow platform makes it reusable and repeatable. |
| **Innovation / originality (15%)** | Parallel sponsor fan-out normalized into one evidence model; sponsor citations feed both a new dashboard and an existing comparison assistant through one toggle; sponsor APIs become reusable agents, not one-off UI calls. |

---

## 6. Architecture

```
apps/web/(app)/livedesk/page.tsx
        │  POST /api/v1/livedesk/research
        ▼
apps/api/app/platform/routers/sponsor.py
        │ asyncio.gather
        ├──► sponsor.serpapi_search()  ──► /search.json  ──► SearchHit[]  (6 engines)
        ├──► sponsor.serpapi_search()  ──► /search.json  ──► SearchHit[]
        └──► sponsor.you_answer()      ──► /v1/answer    ──► CitedAnswer (answer + citations + web)
                                                     │
                                                     ▼
                              normalized JSON → UI collections + sources
                                                     │
                                                     ▼
                              assistant live_sources → cited_evidence() → grounded answer
```

Agent integration path:

```
catalogue preset ──► AgentWrite(kind=serpapi_search | you_research)
                  ──► tools registry (serpapi.search / serpapi.extract / you.search / you.answer)
                  ──► platform runtime → FlowItem(s) with citation metadata → run log + dataset/content
```

Seeded workspace (`python -m app.cli seed-demo-platform`):

```
LiveDesk
├─ Dataset: Research Queue (3 sample questions)
├─ Agents: Web Signal Collector, News Signal Monitor, Cited Answer Desk, Live Research Assistant
└─ Pipeline: Daily live research (manual)
```

---

## 7. Repository commits

| Commit | What it adds |
| --- | --- |
| `4de9489` | Import LayerFlow platform as the hackathon base |
| `716afd5` | SerpApi + You.com sponsor clients, normalization, cache, fallback, tests |
| `a960425` | Sponsor agent kinds, tools, catalogue presets and demo mappings |
| `25a2237` | `/livedesk/research`, cited assistant sources, tests |
| `375f5a6` | Seed LiveDesk workspace, dedicated dashboard, nav and demo handlers |
| docs commit | README + this buildathon guide |

---

## 8. Verification performed

```text
apps/api:  python3 -m pytest -q                 → 142 passed
apps/web:  npm run typecheck                    → clean
apps/web:  npm run build                        → compiled, TypeScript clean, 33 routes including /livedesk
```

The build log included a Next.js advisory recommending an upgrade from the pinned 16.4.2; the production build
completed successfully after the reminder. No auth keys or sponsor keys are committed.

---

## 9. Sponsor credits

- SerpApi bonus credits: [Mumbai](https://serpapi.com/beyond9to5mumbai500) · [Bengaluru](https://serpapi.com/beyond9to5blr)
- You.com platform: https://you.com/platform
