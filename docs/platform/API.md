# LayerFlow Platform API

Two APIs, one server:

| API | Base | Auth | Used by |
| --- | --- | --- | --- |
| **Dashboard API** | `/api/v1` | Session cookie + CSRF header (same as before) | The LayerFlow dashboard |
| **Public API** | `/api/public/v1` | API key (`Authorization: Bearer lf_…` or `X-API-Key`, or `?key=` for the widget) | Client websites (Next.js, WordPress, any blog), the embed widget |

Types for every payload live in [`apps/web/lib/platform-types.ts`](../../apps/web/lib/platform-types.ts).
The original newsroom endpoints (`/feed`, `/articles`, `/seo`, `/publications`, `/social`, `/settings`, `/jobs`, `/dashboard/summary`, …) are unchanged. They now act on the **active workspace**.

---

## 1. Active workspace

Every dashboard request may send `X-Workspace: <slug>`.

- Without the header, the request uses the user's home workspace (`users.tenant_id`).
- With the header, the request is allowed when the user is a **platform admin** (`users.is_platform_admin`). Otherwise the server returns `403 workspace_forbidden`.
- The dashboard keeps the selected slug in `localStorage["lf-workspace"]` and sends it on every request.

`GET /auth/me` adds these fields:

```jsonc
{
  "user": { "...": "...", "is_platform_admin": true },
  "tenant": { "...": "...", "modules": ["newsroom"], "industry": "executive_media", "brand_color": "#8a3b12" },
  "workspaces": [ /* WorkspaceLite[] — every workspace this user may open */ ],
  "csrf_token": "…", "provider": "ollama"
}
```

## 2. Dashboard API (`/api/v1`)

### Platform (operator)
| Method | Path | Returns |
| --- | --- | --- |
| GET | `/platform/overview` | `PlatformOverview` (platform admin only) |
| GET | `/workspaces` | `{ items: Workspace[] }` |
| POST | `/workspaces` | `Workspace` (body `WorkspaceCreate`; `blueprint` applies a blueprint) |
| GET | `/workspaces/{slug}` | `Workspace` |
| PATCH | `/workspaces/{slug}` | `Workspace` (name, industry, brand_color, domain, timezone, modules) |
| DELETE | `/workspaces/{slug}` | `204` (body `{ "confirm": "<slug>" }`; the home workspace cannot be deleted) |
| GET | `/blueprints` | `{ items: Blueprint[] }` |
| POST | `/blueprints/{key}/apply` | `{ agents: Agent[], pipelines: Pipeline[], datasets: Dataset[] }`: creates them in the active workspace |
| GET | `/dashboard/workspace` | `WorkspaceDashboard` |

### Agents
| Method | Path | Returns |
| --- | --- | --- |
| GET | `/agent-types` | `{ items: AgentType[] }` |
| GET | `/agents` | `{ items: Agent[] }` |
| POST | `/agents` | `Agent` (body `AgentWrite`; config validated against the type schema, defaults filled) |
| GET / PATCH / DELETE | `/agents/{id}` | `Agent` / `Agent` / `204`. DELETE returns `409 agent_in_use` while any pipeline uses the agent |
| POST | `/agents/{id}/test` | `AgentTestResult`. Runs the agent once, inline, on the given input; nothing is persisted |

### Pipelines & runs
| Method | Path | Returns |
| --- | --- | --- |
| GET | `/pipelines` | `{ items: Pipeline[] }` |
| POST | `/pipelines` | `Pipeline` (body `PipelineWrite`) |
| GET / PATCH / DELETE | `/pipelines/{id}` | `Pipeline` / `Pipeline` / `204` |
| POST | `/pipelines/{id}/run` | `PipelineRun` (queued; the worker executes it) |
| GET | `/runs?pipeline_id=&status=&limit=50` | `{ items: PipelineRun[] }` |
| GET | `/runs/{id}` | `PipelineRun` (poll every 2s while `queued`/`running`) |
| POST | `/runs/{id}/cancel` | `PipelineRun` |

### Content
| Method | Path | Returns |
| --- | --- | --- |
| GET | `/content?status=&q=&pipeline_id=&limit=50&offset=0` | `Paged<ContentItem>` |
| GET / PATCH | `/content/{id}` | `ContentItem` (PATCH: `title`, `summary`, `tags`, `variants`) |
| POST | `/content/{id}/approve` | `ContentItem`. Resumes a run in `awaiting_approval` (its publisher step runs) |
| POST | `/content/{id}/reject` | `ContentItem` (body `{ reason }`) |
| POST | `/content/{id}/publish` | `ContentItem` (body `{ connection_ids?: string[] }`; queued publish to connections) |
| DELETE | `/content/{id}` | `204` |

### Datasets
| Method | Path | Returns |
| --- | --- | --- |
| GET | `/datasets` | `{ items: Dataset[] }` |
| POST | `/datasets` | `Dataset` (body `DatasetWrite`) |
| GET / PATCH / DELETE | `/datasets/{id}` | `Dataset` / `Dataset` / `204` |
| GET | `/datasets/{id}/records?q=&limit=50&offset=0&sort=` | `Paged<DatasetRecord>` |
| POST | `/datasets/{id}/records` | `DatasetRecord` (body `{ data, source_url? }`; upsert on `key_field`) |
| PATCH / DELETE | `/datasets/{id}/records/{record_id}` | `DatasetRecord` / `204` |
| POST | `/datasets/{id}/import` | `{ created, updated, skipped }` (body `{ rows: object[] }`) |

### Assistant
| Method | Path | Returns |
| --- | --- | --- |
| POST | `/assistant/chat` | `ChatResponse` (body `ChatRequest`); the dashboard playground |

### Connections & API keys
| Method | Path | Returns |
| --- | --- | --- |
| GET | `/connection-kinds` | `{ items: ConnectionKindInfo[] }` |
| GET | `/connections` | `{ items: Connection[] }` |
| POST | `/connections` | `Connection` (body `ConnectionWrite`; secret fields encrypted, never returned) |
| PATCH / DELETE | `/connections/{id}` | `Connection` / `204` |
| POST | `/connections/{id}/test` | `ConnectionTestResult` |
| GET | `/api-keys` | `{ items: ApiKey[] }` |
| POST | `/api-keys` | `ApiKeyCreated` (body `{ name, scopes }`; the secret is shown once) |
| DELETE | `/api-keys/{id}` | `204` (revokes the key) |

---

## 3. Public API (`/api/public/v1`)

CORS is open (`*`) on this prefix. Responses are cached for `s-maxage=60` where noted. Every key belongs to one workspace, so the URLs carry no workspace slug.

| Method | Path | Scope | Returns |
| --- | --- | --- | --- |
| GET | `/content?format=article&tag=&limit=20&offset=0` | `content:read` | `{ items: PublicContent[], total }`: published items only |
| GET | `/content/{slug}` | `content:read` | `PublicContent` |
| GET | `/rss.xml?key=…` | `content:read` | RSS 2.0 feed of published items |
| GET | `/datasets/{slug}/records?q=&limit=50&offset=0&sort=field:desc` | `datasets:read` | `{ dataset: Dataset, items: DatasetRecord[], total }` (public datasets only) |
| GET | `/datasets/{slug}/records/{key}` | `datasets:read` | `DatasetRecord` |
| POST | `/chat` | `assistant:chat` | `ChatResponse` (body `ChatRequest`; rate limited to 20/min per key + IP) |
| POST | `/hooks/pipelines/{pipeline_id}?token=…` | none. The pipeline's webhook token is the auth | `{ run_id }`: runs a pipeline from outside (form submit, cron, Zapier) |

`PublicContent`:

```json
{
  "id": "…", "slug": "rbi-holds-repo-rate", "title": "…", "summary": "…",
  "body_markdown": "…", "body_html": "…", "format": "article",
  "variants": { "linkedin_post": "…", "x_thread": "…" },
  "tags": ["markets"], "image_url": null, "source_url": "…",
  "seo": { "title_tag": "…", "meta_description": "…", "json_ld": {} },
  "published_at": "2026-11-13T08:30:00Z"
}
```

## 4. Outbound webhooks (Next.js / webhook connections)

When content is published to a `nextjs` or `webhook` connection, LayerFlow sends a POST:

```http
POST https://client-site.com/api/layerflow
Content-Type: application/json
X-LayerFlow-Event: content.published
X-LayerFlow-Signature: sha256=<hex hmac of raw body using the connection secret>
```

```json
{ "event": "content.published", "workspace": "marketpulse", "content": { /* PublicContent */ } }
```

The receiver checks the signature, saves or revalidates the content, and returns `2xx`. Failed deliveries retry 3 times (30s, 2m, 10m). See [`docs/integrations/nextjs.md`](../integrations/nextjs.md).

---

## 5. Teams, roles and workspace access

Types: [`apps/web/lib/platform-ops-types.ts`](../../apps/web/lib/platform-ops-types.ts).

- **Memberships** (`memberships`: user × workspace × role) replace "one user, one tenant". `X-Workspace` is honoured only when the user has an **active membership** in that workspace. Platform admins without a membership get read-only **support access**, written to the audit log as `support_access`. They never see connection secrets.
- Roles → permissions:

| Role | Permissions |
| --- | --- |
| owner | all |
| admin | all except deleting the workspace / changing the owner |
| developer | agents.manage, agents.run, integrations.manage, data.edit, view |
| operator | agents.run, content.approve, data.edit, view |
| analyst | view (+ usage, audit) |
| viewer | view |

| Method | Path | Returns |
| --- | --- | --- |
| POST | `/auth/register` | `Me` + session cookies (only when `ALLOW_SIGNUP=true`; creates user, workspace, owner membership, free plan) |
| GET | `/members` | `{ items: Member[] }` |
| POST | `/members` | `InviteResult` (body `InviteRequest`; creates the user with a one-time password if new) |
| PATCH / DELETE | `/members/{id}` | `Member` / `204` (the last owner can't be removed or demoted) |

## 6. Agents: catalogue, lifecycle, live activity

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/catalog` | `{ items: CatalogAgent[] }` |
| POST | `/catalog/{key}/activate` | `ManagedAgent` (body `{ name? }`; checks plan entitlement + agent limit) |
| GET | `/agents/overview` | `AgentsOverview` |
| GET | `/agents/{id}` | `ManagedAgent` (all agent responses now include `AgentLifecycle` fields) |
| POST | `/agents/{id}/run` | `PipelineRun` (body `{ input? }`; the agent runs alone as a one-step run) |
| POST | `/agents/{id}/pause` · `/resume` · `/disable` | `ManagedAgent` (paused agents are skipped by schedules; a pipeline step whose agent is paused/disabled is `skipped` with a reason) |
| PATCH | `/agents/{id}` | also accepts `schedule.every_minutes`, `requires_approval`, `limits`; every config/model change creates a new `AgentVersion` |
| GET | `/agents/{id}/versions` | `{ items: AgentVersion[] }` |
| POST | `/agents/{id}/versions/{version}/restore` | `ManagedAgent` |
| GET | `/agents/{id}/executions?limit=50` | `{ items: AgentExecution[] }` |
| GET | `/agents/{id}/outputs` | `AgentOutputs` |
| GET | `/agents/{id}/events?after=<event id>&limit=100` | `{ items: ExecutionEvent[] }` |
| GET | `/runs/{id}/events?after=` | `{ items: ExecutionEvent[] }` |
| GET | `/events/stream?agent_id=&run_id=` | **SSE** `text/event-stream`: `id: <event id>` / `event: <type>` / `data: <ExecutionEvent JSON>`; honours `Last-Event-ID`; heartbeat comment every 15s |
| GET | `/tools` | `{ items: ToolInfo[] }` |

Events are written by the runtime as work actually happens (run/step lifecycle, every tool call with its duration, every model call), never synthesised.

## 7. Workflows v2, packages, usage, audit, notifications, admin

| Method | Path | Returns |
| --- | --- | --- |
| — | Pipeline steps | accept `StepOptions`: `type: "approval"`, `condition`, `on_error`, `retries`, `label` |
| GET | `/pipelines/{id}/versions` | `{ items: PipelineVersion[] }` (a new version on every change) |
| GET | `/packages` | `{ items: WorkflowPackage[] }` (blueprints with versions + install state) |
| POST | `/packages/{key}/install` | `PackageInstallResult`: never overwrites existing agents/pipelines/datasets with the same name |
| GET | `/usage` | `WorkspaceUsage` |
| GET | `/audit?limit=100&action=` | `{ items: AuditEvent[] }` |
| GET | `/notifications` · POST `/notifications/read-all` | `{ items: NotificationItem[], unread: number }` |
| GET | `/connections/{id}/deliveries` | `{ items: WebhookDelivery[] }` |
| GET | `/platform/health` | `PlatformHealth` (platform admin) |
| GET | `/plans` | `{ items: Plan[] }` |
| PATCH | `/workspaces/{slug}` | also `status` (`active`/`suspended`) and `plan`: platform admin only |

**Quotas** are enforced when work is queued (`429 quota_exceeded` with `{ limit, used }`): runs per day, concurrent runs per workspace (extra runs wait in the queue, which keeps tenants fair), agents, members, records and public API calls per day. Suspended workspaces can't run anything.

## 8. Public execution API (client websites and apps)

| Method | Path | Scope | Returns |
| --- | --- | --- | --- |
| POST | `/api/public/v1/workflows/{pipeline_id}/run` | `runs:write` | `PublicRun` (body `PublicRunRequest`; `Idempotency-Key` header de-duplicates for 24h) |
| POST | `/api/public/v1/agents/{agent_id}/run` | `runs:write` | `PublicRun` |
| GET | `/api/public/v1/runs/{run_id}` | `runs:read` | `PublicRun` (only runs of the key's workspace) |

SDKs: [`packages/sdk-typescript`](../../packages/sdk-typescript) and [`packages/sdk-python`](../../packages/sdk-python). Optional MCP adapter: [`integrations/mcp`](../../integrations/mcp).

## 9. Additional endpoints and notes

| Method | Path | Returns |
| --- | --- | --- |
| POST | `/runs/{id}/approve` · `/runs/{id}/reject` | `PipelineRun`: resumes or stops a run waiting at an approval step (body `{ note?, reason? }`) |
| GET | `/activity?limit=` | `{ items: ExecutionEvent[] }` for the active workspace |
| GET | `/runs?agent_id=` | Runs of one agent (single-agent runs have `pipeline_id: null`, `agent_id` set) |

- `?workspace=<slug>` works anywhere `X-Workspace` does. EventSource needs it because it can't send headers.
- Errors: `429 quota_exceeded` (`details: { limit, used }`), `403 upgrade_required` (premium catalogue agent on a lower plan), `423 workspace_suspended`, `403 workspace_forbidden`.
- `PATCH /workspaces/{slug}` also accepts `website` and `models` (per-workspace model profile overrides).
