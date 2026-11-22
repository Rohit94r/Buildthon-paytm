# LayerFlow documentation

## Product
| Doc | What it covers |
| --- | --- |
| [product/PLATFORM.md](product/PLATFORM.md) | The multi-client agent platform: concepts, agent types, architecture, limits, roadmap |
| [product/agents.md](product/agents.md) | Plain-language guide to all 48 catalogue agents |
| [product/use-cases.md](product/use-cases.md) | Step-by-step client setups: news media autopilot and college portal |
| [product/pitch-explainer.md](product/pitch-explainer.md) | VC / sales talk track (written for the original newsroom; still valid for the Newsroom module) |
| [product/architecture-ten.html](product/architecture-ten.html) | Interactive architecture page of the newsroom engine (open in a browser) |
| [product/original-ten-plan.md](product/original-ten-plan.md) | The original master plan for The Executive Narrative (newsroom module reference) |

## Setup
| Doc | When |
| --- | --- |
| [setup/frontend-demo.md](setup/frontend-demo.md) | Show the dashboard from any laptop, no backend (demo mode) |
| [setup/vps-hostinger-kvm8.md](setup/vps-hostinger-kvm8.md) | Production deploy on the Hostinger KVM 8 |
| [setup/models.md](setup/models.md) | Which models to run, speed, capacity, upgrades |
| [setup/local-dev.md](setup/local-dev.md) | Running API + worker + web locally (Windows/macOS/Linux) |

## Integrations (client websites)
[integrations/README.md](integrations/README.md) · [Next.js](integrations/nextjs.md) · [WordPress](integrations/wordpress.md) · [Embed widget](integrations/embed-widget.md) · [Webhooks](integrations/webhook.md) · [SDKs, external runs & MCP](integrations/sdk.md)

## Reference
| Doc | |
| --- | --- |
| [platform/API.md](platform/API.md) | Dashboard API + public API + webhook contract |
| [reference/contracts.md](reference/contracts.md) | JSON schemas shared by Python and TypeScript (newsroom) |
| [reference/evals-golden-set.md](reference/evals-golden-set.md) · [reference/evals-style-samples.md](reference/evals-style-samples.md) | Evaluation set and style samples |

## Operations
| Doc | |
| --- | --- |
| [ops/runbook.md](ops/runbook.md) | Deploy, update, backups, restore, alerts, troubleshooting |
| [ops/demo-script-ten.md](ops/demo-script-ten.md) | 10-minute newsroom demo script (also the Playwright E2E) |

## Decisions (ADRs)
[001 Postgres queue](decisions/ADR-001-postgres-queue.md) · [002 Ollama provider](decisions/ADR-002-ollama-provider.md) · [003 Deterministic orchestration](decisions/ADR-003-deterministic-orchestration.md) · [004 Human approval](decisions/ADR-004-human-approval-gate.md) · [005 Publishing adapters](decisions/ADR-005-publishing-adapters.md) · [006 Tenant-scoped data](decisions/ADR-006-tenant-scoped-data.md) · [007 Multi-client platform](decisions/ADR-007-multi-client-platform.md)

> Agent prompts live in [`/prompts`](../prompts/). They are runtime data read by the agents, not documentation.
