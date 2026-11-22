# LayerFlow

**A multi-client AI agent platform.** One self-hosted install runs a different team of AI agents for every client. The agents scrape and collect data, rewrite it in the client's voice, produce every format (article, LinkedIn, X thread, Instagram, newsletter, video script), check quality and SEO, and publish to the client's website and channels. A real-time AI assistant answers and compares from live datasets.

Local open-weight models (Ollama): **no per-token API bill**.

| | |
| --- | --- |
| **See it now (no backend)** | `cd apps/web && pnpm install && NEXT_PUBLIC_DEMO_MODE=true pnpm dev` → http://localhost:3000 · [guide](docs/setup/frontend-demo.md) |
| **Deploy on the VPS** | `sudo bash scripts/vps/install.sh` · [Hostinger KVM 8 guide](docs/setup/vps-hostinger-kvm8.md) · [models](docs/setup/models.md) |
| **Product** | [Platform overview](docs/product/PLATFORM.md) · [Client playbooks: news site · college portal · hackathon site](docs/product/use-cases.md) |
| **Connect client sites** | [Next.js](docs/integrations/nextjs.md) · [WordPress](docs/integrations/wordpress.md) · [Embed widget](docs/integrations/embed-widget.md) · [Webhooks](docs/integrations/webhook.md) · [SDKs + run API](docs/integrations/sdk.md) |
| **All docs** | [docs/README.md](docs/README.md) |

## What's inside

```
Workspace (client) ─► Agents ─► Pipelines ─► Runs ─► Content ─► Connections ─► client site / social
                            └─► Datasets ─► Assistant (dashboard + website widget)
```

| Agent type | Does |
| --- | --- |
| Web scraper · News monitor | Collect from pages, RSS, sitemaps, Google News (robots-aware, rate-limited) |
| Persona rewriter · Multi-format | Write in the client's voice; one story → 9 formats |
| Data transform | Dedupe, filter, sort, limit, rename, AI-categorize (e.g. open hackathons by deadline) |
| SEO optimizer · Quality gate | Metadata + JSON-LD; grounding, banned phrases, duplicates |
| Auto publisher | Next.js · WordPress · webhook · LinkedIn · Telegram · X · Ghost |
| Dataset builder · Comparison assistant | Structured data (colleges, products, prices) + real-time side-by-side answers |
| Custom LLM | Your own prompt and output fields |

Plus the original **Newsroom module** (research with citations, six editorial categories, review queue, scheduler) that runs The Executive Narrative.

## Stack

Next.js 16 dashboard · FastAPI + SQLAlchemy · Postgres (state + job queue) · Python worker · Ollama (Qwen2.5 3B/7B + nomic-embed) · Caddy (auto HTTPS) · Docker Compose.

## Repository layout

```
apps/web          Next.js dashboard (platform + newsroom screens, demo mode, embeddable widget.js)
apps/api          FastAPI API, public API, agent runtime, worker, CLI, Alembic migrations, tests
integrations/     Copy-paste kits for client sites: Next.js, WordPress plugin, webhook receivers, MCP adapter
packages/         Shared libraries: sdk-typescript, sdk-python (public API clients), contracts (JSON schemas)
prompts/          Versioned prompts used by the newsroom agents (runtime data)
config/           News sources, competitors, tenant seed
templates/        Newsroom article template (static publishing)
evals/            Golden evaluation set
scripts/          VPS install/update/models, backup/restore, benchmarks, local model setup
infra/            Postgres init, systemd units
docs/             Everything else: product, setup, integrations, API, ops, decisions
```

### Code map (where new things go)

| Add… | Put it in | Registered by |
| --- | --- | --- |
| A new agent engine | `apps/api/app/platform/kinds/<kind>.py` | `kinds/__init__.py` registry + `platform/catalog.py` schema |
| A catalogue agent (preset of an engine) | `apps/api/app/platform/catalog_agents.py` | no code: a data entry |
| A tool agents can call | `apps/api/app/platform/tools/` | tool registry (`invoke()` enforces permissions, timeouts, audit) |
| A connection type (CRM, channel) | `apps/api/app/platform/connections.py` | `CONNECTION_KINDS` |
| A sample workspace for demos/seeding | `apps/api/app/platform/seed.py` | `python -m app.cli seed-demo-platform` |
| Plans / limits | `apps/api/app/platform/plans.py` | enforced at enqueue |
| Database change | `apps/api/alembic/versions/` | `python -m app.cli migrate` |
| A dashboard screen | `apps/web/app/(app)/<route>/page.tsx` + `components/platform/` | add demo handler in `apps/web/lib/demo/` |

Shared backend infrastructure lives in `core/` (auth, tenancy, permissions), `models/`, `providers/` (model gateway), `queue/` and `services/` (fetcher, extraction, SEO rules). The original TEN newsroom keeps its own `agents/`, `adapters/` and `routers/` and is untouched by platform changes.

## Local development

See [docs/setup/local-dev.md](docs/setup/local-dev.md) for running API, worker and web with SQLite and Ollama (or the mock model). The backend tests run fully offline: `cd apps/api && .venv/Scripts/python -m pytest` (`.venv/bin/python` on macOS/Linux).

## License

Private project. All rights reserved.
