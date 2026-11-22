// LayerFlow Platform — wave 2 contract: teams & roles, agent catalogue & plans, agent lifecycle + live activity,
// tool registry, workflow steps v2, packages, external execution API, usage/quotas, audit, notifications, platform admin.
// Mirrors the FastAPI serializers. Endpoint list: docs/platform/API.md §5–§7.

import type { Agent, AgentCategory, AgentKind, Blueprint, ConnectionKind, FlowItem, Module, RunStatus } from "./platform-types";

/* ------------------------------------------------------------------ */
/* Teams, roles, sign-up                                                */
/* ------------------------------------------------------------------ */

export type Role = "owner" | "admin" | "developer" | "operator" | "analyst" | "viewer";

/** What each role may do (server enforces; UI hides/disables). */
export type Permission =
  | "workspace.manage" // settings, plan, delete (owner, admin)
  | "members.manage" // invite/remove/change roles (owner, admin)
  | "agents.manage" // create/configure/activate/delete agents & workflows (owner, admin, developer)
  | "agents.run" // run/pause/resume, approve content (owner, admin, developer, operator)
  | "content.approve" // approve/reject/publish content (owner, admin, operator)
  | "integrations.manage" // connections, API keys, webhooks (owner, admin, developer)
  | "data.edit" // dataset records (owner, admin, developer, operator)
  | "view"; // everything read-only (all roles; analyst + viewer only have this… analyst also sees usage/audit)

export interface Member {
  id: string; // membership id
  user_id: string;
  email: string;
  name: string | null;
  role: Role;
  status: "active" | "invited";
  last_login_at: string | null;
  created_at: string;
}

export interface InviteRequest {
  email: string;
  name?: string;
  role: Role;
}

export interface InviteResult {
  member: Member;
  /** One-time password for a brand-new user (no email service configured). Shown once. Null if the user existed. */
  temp_password: string | null;
}

/** POST /auth/register (only when the server allows sign-up). Creates user + workspace + owner membership. */
export interface RegisterRequest {
  company: string;
  name: string;
  email: string;
  password: string;
  industry?: string;
  website?: string;
}

/** Extra fields on /auth/me (all optional for older servers). */
export interface MeExtras {
  role?: Role; // role in the ACTIVE workspace
  permissions?: Permission[];
  support_access?: boolean; // platform admin viewing a workspace they are not a member of (audited)
  signup_enabled?: boolean;
}

/* ------------------------------------------------------------------ */
/* Plans, usage, quotas (entitlements — payment provider not included)  */
/* ------------------------------------------------------------------ */

export type PlanKey = "free" | "starter" | "pro" | "business" | "enterprise";

export interface PlanLimits {
  agents: number; // -1 = unlimited
  runs_per_day: number;
  concurrent_runs: number;
  records: number;
  api_calls_per_day: number;
  members: number;
  premium_agents: boolean; // may activate catalogue agents priced above "free"
}

export interface Plan {
  key: PlanKey;
  name: string;
  price_inr_month: number | null; // null = custom
  description: string;
  limits: PlanLimits;
}

export interface WorkspaceUsage {
  plan: Plan;
  period_start: string;
  usage: {
    agents: number;
    members: number;
    records: number;
    runs_today: number;
    runs_month: number;
    running_now: number;
    api_calls_today: number;
    model_calls_month: number;
    model_tokens_month: number;
    items_processed_month: number;
  };
  by_day: { day: string; runs: number; model_tokens: number; api_calls: number }[]; // last 30 days
  /** Payment checkout is NOT implemented: plan changes are made by a platform admin. */
  billing_note: string;
}

/* ------------------------------------------------------------------ */
/* Agent catalogue (platform-owned agents built on agent kinds)         */
/* ------------------------------------------------------------------ */

export type CatalogCategory =
  | "collect"
  | "images"
  | "research"
  | "content"
  | "seo"
  | "data"
  | "publishing"
  | "sales"
  | "support"
  | "operations"
  | "assist";

export interface CatalogAgent {
  key: string; // "seo_auditor", "research_analyst", "news_discovery", "content_writer", "fact_checker", …
  name: string;
  tagline: string;
  description: string;
  /** One plain-language line: what a normal person uses it for. */
  everyday_use: string;
  category: CatalogCategory;
  kind: AgentKind; // the runtime engine it is built on
  kind_category: AgentCategory;
  icon: string; // lucide name
  capabilities: string[];
  tools: string[]; // ToolInfo keys it uses
  integrations: ConnectionKind[]; // optional/required connections
  required_config: string[]; // config keys the user must fill
  example_workflows: string[];
  pricing: { tier: "free" | "pro" | "enterprise"; price_inr_month: number | null; note: string | null };
  availability: "available" | "beta";
  version: string; // semver of the catalogue definition
  docs: string;
  /** Per workspace */
  entitled: boolean; // plan allows it
  activated_agent_ids: string[]; // agents in this workspace created from this entry
}

/* ------------------------------------------------------------------ */
/* Agent lifecycle, versions, executions, live events                   */
/* ------------------------------------------------------------------ */

export type AgentStatus = "active" | "paused" | "disabled";
export type AgentSource = "platform" | "package" | "custom"; // catalogue entry / installed by package / built from scratch

/** Extra fields on Agent (wave 2). The API returns Agent & AgentLifecycle. */
export interface AgentLifecycle {
  status: AgentStatus;
  version: number;
  source: AgentSource;
  catalog_key: string | null;
  package_key: string | null;
  schedule: { every_minutes: number | null; next_run_at: string | null };
  requires_approval: boolean; // outputs of external actions wait for approval
  limits: { max_items: number; timeout_s: number; max_retries: number };
  tools: string[]; // ToolInfo keys
  live: { run_id: string; started_at: string; message: string | null } | null; // currently running
  last_error: string | null;
}

export type ManagedAgent = Agent & AgentLifecycle;

export interface AgentVersion {
  version: number;
  config: Record<string, unknown>;
  model: string;
  note: string | null;
  created_by: string | null; // email
  created_at: string;
}

export interface AgentExecution {
  run_id: string;
  step_id: string;
  pipeline_id: string | null; // null = agent ran on its own
  pipeline_name: string | null;
  trigger: "manual" | "schedule" | "webhook" | "api";
  status: "queued" | "running" | "succeeded" | "failed" | "skipped" | "awaiting_approval" | "cancelled";
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  items_in: number;
  items_out: number;
  tools_used: string[];
  attempts: number;
  model_calls: number;
  error: string | null;
}

export type ExecutionEventType =
  | "run.queued"
  | "run.started"
  | "step.started"
  | "step.log"
  | "tool.called"
  | "tool.result"
  | "model.called"
  | "step.finished"
  | "step.failed"
  | "step.skipped"
  | "run.awaiting_approval"
  | "run.retrying"
  | "run.finished"
  | "run.failed"
  | "run.cancelled";

/** Persisted, real execution events (never synthesised). Streamed over SSE. */
export interface ExecutionEvent {
  id: number; // monotonically increasing per workspace (use as SSE Last-Event-ID / ?after=)
  at: string;
  run_id: string;
  step_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  type: ExecutionEventType;
  level: "info" | "warn" | "error";
  message: string; // customer-visible, secrets redacted
  data: Record<string, unknown>; // e.g. { tool, items, url, duration_ms }
}

export interface AgentOutputs {
  items: FlowItem[]; // last successful execution's output items (truncated)
  content_ids: string[];
  dataset_changes: { dataset_id: string; created: number; updated: number } | null;
  report: string | null; // markdown (site_auditor, report_builder, researcher)
}

export interface AgentsOverview {
  totals: {
    activated: number;
    running: number;
    idle: number;
    paused: number;
    scheduled: number;
    awaiting_approval: number;
    failed_24h: number;
    executions_7d: number;
    items_processed_7d: number;
    success_rate_7d: number | null; // 0..1
  };
  upcoming: { agent_id: string | null; pipeline_id: string | null; name: string; at: string }[];
  recent: ExecutionEvent[];
}

/* ------------------------------------------------------------------ */
/* Tool registry                                                        */
/* ------------------------------------------------------------------ */

export interface ToolInfo {
  key: string; // "web.fetch", "web.search", "rss.read", "sitemap.read", "html.extract", "ai.extract", "seo.analyze", "dataset.read", "dataset.upsert", "content.save", "publish.connection", "http.request", "notify.send", "image.discover", "model.generate"
  name: string;
  description: string;
  version: string;
  category: "web" | "data" | "ai" | "seo" | "publish" | "notify" | "integration";
  input_schema: Record<string, unknown>; // JSON Schema
  output_schema: Record<string, unknown>;
  permissions: string[]; // e.g. ["network:public"], ["dataset:write"], ["external:side_effect"]
  requires_connection: ConnectionKind[] | null;
  timeout_s: number;
  retries: number;
  side_effects: boolean; // true = external action, follows approval policy
}

/* ------------------------------------------------------------------ */
/* Workflows v2                                                         */
/* ------------------------------------------------------------------ */

export interface StepCondition {
  field: string; // e.g. "items.count", "data.score", "flags"
  op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "contains" | "not_contains" | "exists" | "empty" | "not_empty";
  value?: unknown;
}

/** Extra optional fields on PipelineStep / PipelineWrite steps. */
export interface StepOptions {
  type?: "agent" | "approval"; // approval = pause the run until a human approves in the dashboard
  condition?: StepCondition | null; // skip the step (status "skipped") when false
  on_error?: "stop" | "continue" | "retry"; // default stop
  retries?: number; // for on_error retry, max 3
  label?: string | null;
}

export interface PipelineVersion {
  version: number;
  steps: unknown[];
  trigger: unknown;
  created_by: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Packages (versioned blueprints)                                      */
/* ------------------------------------------------------------------ */

export interface WorkflowPackage extends Blueprint {
  version: string;
  required_integrations: ConnectionKind[];
  catalog_agents: string[]; // CatalogAgent keys it installs
  installed: { version: string; at: string; upgrade_available: boolean } | null;
}

export interface PackageInstallResult {
  created: { agents: number; pipelines: number; datasets: number };
  skipped: string[]; // names that already existed (never overwritten)
  package: { key: string; version: string };
}

/* ------------------------------------------------------------------ */
/* External execution (public API for client websites/apps)             */
/* ------------------------------------------------------------------ */

export interface PublicRunRequest {
  input?: { text?: string; url?: string; items?: Partial<FlowItem>[]; data?: Record<string, unknown> };
  wait?: boolean; // wait up to 25s for completion before returning
}

export interface PublicRun {
  id: string;
  status: RunStatus;
  workflow: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
  created_at: string;
  finished_at: string | null;
  steps: { name: string; status: string; items_out: number }[];
  output: { items: FlowItem[]; content_ids: string[] } | null; // when succeeded
  error: string | null;
}

export interface WebhookDelivery {
  id: string;
  connection_id: string;
  event: string;
  url: string;
  status_code: number | null;
  ok: boolean;
  attempts: number;
  duration_ms: number | null;
  error: string | null;
  at: string;
}

/* ------------------------------------------------------------------ */
/* Audit, notifications, platform admin                                 */
/* ------------------------------------------------------------------ */

export interface AuditEvent {
  id: string;
  at: string;
  actor: string; // email | "agent:<name>" | "system" | "api_key:<prefix>"
  action: string; // "agent.activated", "workflow.updated", "member.invited", "support_access", …
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
}

export interface NotificationItem {
  id: string;
  at: string;
  kind: "approval_needed" | "run_failed" | "quota" | "connection_error" | "info";
  title: string;
  body: string;
  link: string | null; // dashboard route
  read: boolean;
}

export interface PlatformHealth {
  provider: string;
  model: { status: "ok" | "degraded" | "down"; detail: string | null; models: string[] };
  queue: { queued: number; running: number; failed_24h: number; dead: number; oldest_queued_age_s: number | null };
  workers: { id: string; last_seen: string; running: number }[];
  errors_24h: { at: string; workspace: string; message: string }[];
}

/** Extra fields on Workspace (wave 2). */
export interface WorkspaceAdminFields {
  status: "active" | "suspended";
  plan: PlanKey;
  website: string | null;
}

export type { Module };

/* ------------------------------------------------------------------ */
/* Wave 3: images, progress (gamification from real data), usage per agent, unified activity */
/* ------------------------------------------------------------------ */

/** An image found or attached by agents. Open-licensed sources are preferred. */
export interface MediaImage {
  url: string;
  thumb_url: string | null;
  page_url: string | null; // where it was found
  source: "page" | "og" | "openverse" | "wikimedia" | "upload";
  license: string | null; // e.g. "CC BY 4.0", "CC0", "Public domain", null = unknown (use with care)
  license_url: string | null;
  open_license: boolean; // true for CC0 / PD / CC BY / CC BY-SA
  credit: string | null; // creator / attribution line to show
  width: number | null;
  height: number | null;
  hash: string | null; // perceptual dHash (16 hex chars) — equal/near hashes = same picture
  alt: string | null; // alt text (page alt, caption, or AI-written when a vision model is configured)
}

/** ContentItem.images and FlowItem.data.images carry MediaImage[] (ContentItem.image_url = first image). */
export interface ContentImages {
  images: MediaImage[];
}

export interface Achievement {
  key: string; // "first_run", "hundred_items", "first_publish", "streak_7", "five_agents", "first_connection", "first_dataset", "zero_failures_week", …
  title: string; // "First run"
  description: string; // "Run any agent once"
  icon: string; // lucide name
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number; // 0..1 towards unlocking (computed from real counts)
  target: number; // e.g. 100 (items)
  current: number; // e.g. 42
}

/** GET /progress — everything derived from real workspace data (no fake points). */
export interface WorkspaceProgress {
  level: number; // 1..
  level_name: string; // "Getting started", "Automator", "Pro operator", "Agent master"
  xp: number; // total points
  xp_level_start: number;
  xp_next_level: number;
  streak_days: number; // consecutive days (workspace timezone) with ≥1 successful run
  best_streak_days: number;
  today: { runs: number; items: number; content: number; published: number; records: number };
  week: { runs: number; items: number; content: number; published: number; success_rate: number | null };
  /** Estimate, clearly labelled in the UI: items × typical manual minutes per agent kind. */
  time_saved_minutes_week: number;
  achievements: Achievement[];
  next_steps: { key: string; title: string; description: string; href: string; done: boolean }[]; // onboarding checklist
  xp_rules: { action: string; points: number }[]; // shown in a "how points work" popover
}

/** GET /usage now also includes per-agent usage for the current month. */
export interface AgentUsage {
  agent_id: string;
  name: string;
  kind: string;
  catalog_key: string | null;
  runs: number;
  succeeded: number;
  failed: number;
  items_out: number;
  model_calls: number;
  model_tokens: number;
  tool_calls: number;
  avg_duration_ms: number | null;
  last_run_at: string | null;
}

export interface WorkspaceUsageWithAgents extends WorkspaceUsage {
  by_agent: AgentUsage[];
}

/** GET /activity — one merged feed: execution events + content/publish/dataset/connection/member/agent audit events. */
export interface ActivityItem {
  id: string;
  at: string;
  category: "run" | "agent" | "content" | "publish" | "data" | "connection" | "team" | "system";
  type: string; // e.g. "run.finished", "content.published", "agent.activated", "records.saved", "member.invited"
  level: "info" | "success" | "warn" | "error";
  title: string; // short human sentence: "Hackathon Sorter kept 19 of 44 items"
  detail: string | null;
  actor: string | null; // person or agent name
  agent_id: string | null;
  run_id: string | null;
  link: string | null; // dashboard route
  xp: number; // points this event earned (0 for most)
  metrics: Record<string, number>; // e.g. { items: 19, removed: 25 }
}
