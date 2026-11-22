// LayerFlow Platform — shared API contract (dashboard ⇄ FastAPI).
// Mirrors apps/api/app/platform/serializers.py. Change both in the same commit.
// Full endpoint list: docs/platform/API.md

/* ------------------------------------------------------------------ */
/* Workspaces (= clients / tenants)                                    */
/* ------------------------------------------------------------------ */

export type Module = "newsroom" | "pipelines" | "datasets" | "assistant";

export interface WorkspaceStats {
  agents: number;
  pipelines: number;
  runs_24h: number;
  failed_24h: number;
  content_7d: number;
  published_7d: number;
  records: number;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  industry: string; // "news_media" | "education" | "executive_media" | "ecommerce" | "blog" | "other"
  brand_color: string; // hex, e.g. "#2563eb"
  domain: string | null;
  timezone: string;
  modules: Module[];
  blueprint: string | null; // key of the blueprint it was created from
  created_at: string;
  stats: WorkspaceStats;
}

/** Light version returned inside /auth/me for the workspace switcher. */
export interface WorkspaceLite {
  id: string;
  slug: string;
  name: string;
  industry: string;
  brand_color: string;
  modules: Module[];
  role?: import("./platform-ops-types").Role; // your role in this workspace
  member?: boolean; // false = platform-admin support access (read-only)
}

export interface WorkspaceCreate {
  name: string;
  slug?: string;
  industry: string;
  brand_color?: string;
  domain?: string | null;
  timezone?: string;
  blueprint?: string | null; // apply a blueprint on creation
}

/* ------------------------------------------------------------------ */
/* Blueprints (ready-made agent teams per industry)                    */
/* ------------------------------------------------------------------ */

export interface Blueprint {
  key: string; // "news_media_autopilot" | "college_portal" | "executive_newsroom" | "blog_seo_autopilot" | "ecommerce_price_watch"
  name: string;
  tagline: string;
  description: string;
  industry: string;
  icon: string; // lucide icon name, e.g. "Newspaper"
  agents: { name: string; kind: AgentKind; description: string }[];
  pipelines: { name: string; steps: string[]; trigger: string }[];
  datasets: string[];
  modules: Module[];
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export type AgentKind =
  | "web_scraper" // collect: pages / RSS / sitemaps -> items (CSS selectors or AI extraction)
  | "news_monitor" // collect: keyword/topic news discovery from feeds, Google News, GDELT
  | "persona_rewriter" // create: rewrite items in a persona / brand voice
  | "multi_format" // create: one item -> blog, LinkedIn, X thread, Instagram, newsletter, video script…
  | "seo_optimizer" // quality: title/meta/slug/keywords/JSON-LD
  | "quality_gate" // quality: fact grounding, banned phrases, length, duplication -> pass/flag/drop
  | "data_transform" // data: filter / dedupe / sort / limit / rename fields / AI-categorize items (e.g. sort hackathons by deadline)
  | "auto_publisher" // deliver: push approved content to connections (Next.js, WordPress, webhook, LinkedIn, Telegram…)
  | "dataset_builder" // data: scrape structured records into a dataset (upsert by key)
  | "comparison_assistant" // assist: real-time Q&A + side-by-side comparison over a dataset
  | "custom_llm" // anything: your own prompt + output fields
  // ---- wave 2 (see platform-ops-types.ts) ----
  | "researcher" // collect: question/topic -> search + fetch + evidence pack with cited sources
  | "fact_checker" // quality: verify claims in items against their sources -> verified / unsupported / contradicted
  | "site_auditor" // quality: crawl a website -> technical + on-page SEO report (missing meta, titles, H1, canonical, OG, JSON-LD, broken links)
  | "image_finder" // collect: find permitted lead images (og:image, page images) with credit + dimensions
  | "change_detector" // data: compare incoming items with dataset records -> new / changed / unchanged + field diffs
  | "http_action" // deliver: call an allowlisted REST API connection (CRM, Sheets, internal API) with templated JSON
  | "notifier" // deliver: send a message/digest to Telegram, Slack, Discord, email or webhook
  | "report_builder" // create: summarise items/run output into a report (markdown) saved as content
  // ---- wave 3 ----
  | "link_collector" // collect: gather + normalise URLs from pages / sitemaps / search, filter by pattern, dedupe
  | "document_reader" // collect: read PDFs / documents from URLs -> text + extracted fields
  | "page_watcher" // collect: watch pages (or one element) and emit only what changed since last check
  | "keyword_researcher" // quality: keyword ideas from free autosuggest + competitor pages, grouped by intent
  | "comparer" // data: match the same thing across sources (fuzzy) -> comparison table + best value per field
  // ---- Beyond 9TO5 sponsor engines ----
  | "serpapi_search" // collect: real-time Google Web/News/Jobs/Shopping/Maps/Scholar results via SerpApi
  | "you_research"; // collect: live cited answers/sources via You.com Answer + Web Search APIs

export type AgentCategory = "collect" | "create" | "quality" | "deliver" | "data" | "assist";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "string_list" // list of strings (keywords, urls)
  | "sources" // list of {url, type: "rss"|"html"|"sitemap"|"json"} objects
  | "extract_fields" // list of {key, label, type, selector?, description?}
  | "connections" // multiselect of connection ids in this workspace
  | "dataset" // one dataset id
  | "model" // "fast" | "writer" | explicit ollama tag
  | "formats"; // multiselect of ContentFormat

export interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  options?: { value: string; label: string }[];
  secret?: boolean; // write-only (connections)
  min?: number;
  max?: number;
}

export interface AgentType {
  kind: AgentKind;
  name: string;
  description: string;
  category: AgentCategory;
  icon: string; // lucide icon name
  uses_model: boolean;
  default_model: "fast" | "writer" | null;
  inputs: string; // human description, e.g. "Items with text"
  outputs: string;
  config_schema: ConfigField[];
}

export interface AgentStats {
  runs: number;
  last_run_at: string | null;
  success_rate: number | null; // 0..1
  avg_ms: number | null;
}

export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  description: string;
  config: Record<string, unknown>;
  model: string; // "fast" | "writer" | explicit tag
  enabled: boolean;
  created_at: string;
  updated_at: string;
  stats: AgentStats;
}

export interface AgentWrite {
  name: string;
  kind: AgentKind;
  description?: string;
  config?: Record<string, unknown>;
  model?: string;
  enabled?: boolean;
}

/** One unit of data flowing between pipeline steps. */
export interface FlowItem {
  id: string;
  title: string;
  url: string | null;
  text: string;
  summary: string | null;
  source_name: string | null;
  published_at: string | null;
  image_url: string | null;
  data: Record<string, unknown>; // extracted fields
  formats: Partial<Record<ContentFormat, string>>; // set by multi_format
  flags: string[]; // set by quality_gate
}

export interface AgentTestRequest {
  input?: { text?: string; url?: string; items?: Partial<FlowItem>[] };
  config_override?: Record<string, unknown>;
}

export interface AgentTestResult {
  ok: boolean;
  duration_ms: number;
  items: FlowItem[];
  logs: RunLog[];
  error: string | null;
  model: string | null;
}

/* ------------------------------------------------------------------ */
/* Pipelines + runs                                                    */
/* ------------------------------------------------------------------ */

export interface PipelineStep {
  id: string; // stable step id (uuid hex)
  agent_id: string | null; // null for approval steps
  type?: "agent" | "approval";
  condition?: import("./platform-ops-types").StepCondition | null;
  on_error?: "stop" | "continue" | "retry";
  retries?: number;
  label?: string | null;
  agent_name?: string; // read-only, filled by API
  kind?: AgentKind; // read-only, filled by API
  overrides?: Record<string, unknown>;
}

export interface PipelineTrigger {
  type: "manual" | "schedule" | "webhook";
  every_minutes?: number | null; // schedule
  webhook_url?: string | null; // read-only, filled by API for webhook triggers
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  steps: PipelineStep[];
  trigger: PipelineTrigger;
  require_approval: boolean; // pause before auto_publisher until content is approved
  enabled: boolean;
  next_run_at: string | null;
  last_run: PipelineRunSummary | null;
  runs_7d: number;
  created_at: string;
  updated_at: string;
}

export interface PipelineWrite {
  name: string;
  description?: string;
  steps: { id?: string; agent_id: string; overrides?: Record<string, unknown> }[];
  trigger: { type: "manual" | "schedule" | "webhook"; every_minutes?: number | null };
  require_approval?: boolean;
  enabled?: boolean;
}

export type RunStatus = "queued" | "running" | "awaiting_approval" | "succeeded" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface RunLog {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RunStep {
  step_id: string;
  agent_id: string;
  agent_name: string;
  kind: AgentKind | "approval";
  type?: "agent" | "approval";
  label?: string | null;
  attempts?: number;
  status: StepStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  items_in: number;
  items_out: number;
  logs: RunLog[];
  error: string | null;
}

export interface PipelineRunSummary {
  id: string;
  status: RunStatus;
  trigger: "manual" | "schedule" | "webhook" | "api";
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  items_out: number;
  content_created: number;
}

export interface PipelineRun extends PipelineRunSummary {
  pipeline_id: string | null; // null = a single agent ran on its own
  agent_id?: string | null;
  pipeline_name: string;
  error: string | null;
  steps: RunStep[];
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Content (multi-format outputs)                                      */
/* ------------------------------------------------------------------ */

export type ContentFormat =
  | "article"
  | "blog_post"
  | "linkedin_post"
  | "x_thread"
  | "instagram_caption"
  | "facebook_post"
  | "newsletter"
  | "short_video_script"
  | "whatsapp_message";

export type ContentStatus = "draft" | "approved" | "published" | "rejected" | "failed";

export interface ContentVariant {
  format: ContentFormat;
  title: string | null;
  body: string; // markdown for article/blog/newsletter, plain text for social
  char_count: number;
}

export interface ContentPublication {
  connection_id: string;
  connection_name: string;
  kind: ConnectionKind;
  format: ContentFormat;
  status: "published" | "failed" | "manual"; // manual = copy/paste required (no API access)
  url: string | null;
  error: string | null;
  at: string;
}

export interface ContentItem {
  id: string;
  run_id: string | null;
  pipeline_id: string | null;
  pipeline_name: string | null;
  title: string;
  slug: string;
  summary: string;
  source_url: string | null;
  source_name: string | null;
  persona: string | null;
  status: ContentStatus;
  tags: string[];
  image_url: string | null;
  seo: { title_tag?: string; meta_description?: string; keywords?: string[]; json_ld?: Record<string, unknown> } | null;
  quality: { score: number; flags: string[] } | null;
  variants: ContentVariant[];
  /** Images found or attached by agents (image_url = the cover, usually the first). */
  images: import("./platform-ops-types").MediaImage[];
  publications: ContentPublication[];
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
}

/* ------------------------------------------------------------------ */
/* Datasets                                                            */
/* ------------------------------------------------------------------ */

export type DatasetFieldType = "text" | "number" | "currency" | "url" | "list" | "rating" | "boolean" | "date";

export interface DatasetField {
  key: string;
  label: string;
  type: DatasetFieldType;
  compare?: boolean; // shown in comparison tables
  unit?: string; // e.g. "₹", "LPA", "%"
  higher_is_better?: boolean; // highlights winner in comparisons
}

export interface Dataset {
  id: string;
  name: string;
  slug: string;
  description: string;
  key_field: string; // which field uniquely identifies a record (e.g. "name")
  fields: DatasetField[];
  public: boolean; // readable via the public API
  record_count: number;
  updated_at: string;
  created_at: string;
}

export interface DatasetWrite {
  name: string;
  slug?: string;
  description?: string;
  key_field: string;
  fields: DatasetField[];
  public?: boolean;
}

export interface DatasetRecord {
  id: string;
  dataset_id: string;
  key: string;
  data: Record<string, unknown>;
  source_url: string | null;
  updated_at: string;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Assistant (real-time comparison / Q&A)                              */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  assistant_id?: string; // a comparison_assistant agent id; else dataset is required
  dataset?: string; // dataset id or slug
  message: string;
  history?: ChatMessage[];
  compare_keys?: string[]; // force-compare these records
  live_sources?: boolean; // ground the answer in fresh SerpApi / You.com web sources
}

export interface ChatSource {
  number: number;
  title: string;
  source: string;
  excerpt?: string;
  provider?: string;
}

export interface ComparisonTable {
  fields: DatasetField[];
  rows: { key: string; values: Record<string, unknown> }[];
  winners: Record<string, string>; // field key -> record key with the best value
}

export interface ChatResponse {
  answer: string; // markdown
  records: DatasetRecord[]; // records used as context
  table: ComparisonTable | null;
  suggestions: string[]; // follow-up questions
  sources: ChatSource[]; // sponsor-backed citations (empty unless live_sources was requested)
  sources_degraded: boolean; // true when the sponsor APIs were unavailable and sample data was used
  model: string;
  latency_ms: number;
}

/* ------------------------------------------------------------------ */
/* LiveDesk (SerpApi + You.com research)                                */
/* ------------------------------------------------------------------ */

export type LiveDeskEngine = "google" | "google_news" | "google_jobs" | "google_shopping" | "google_maps" | "google_scholar";

export interface LiveDeskSearchHit {
  title: string;
  url: string;
  summary: string;
  source: string;
  published_at: string | null;
  position: number;
  provider: string;
  engine: string;
  query: string;
  extra: Record<string, unknown>;
}

export interface LiveDeskCollection {
  engine: LiveDeskEngine;
  label: string;
  provider: string;
  degraded: boolean;
  hits: LiveDeskSearchHit[];
}

export interface LiveDeskStatus {
  keys: { serpapi: boolean; youcom: boolean };
  mode: "live" | "demo";
  engines: { key: LiveDeskEngine; label: string }[];
}

export interface LiveDeskRequest {
  query: string;
  engines?: LiveDeskEngine[];
  location?: string;
  count?: number;
}

export interface LiveDeskResponse {
  query: string;
  answer: {
    answer: string;
    citations: ChatSource[];
    results: LiveDeskSearchHit[];
    provider: string;
    degraded: boolean;
  };
  collections: LiveDeskCollection[];
  evidence: string;
  sources: ChatSource[];
  keys: { serpapi: boolean; youcom: boolean };
  degraded: boolean;
  latency_ms: number;
}

/* ------------------------------------------------------------------ */
/* Connections + API keys                                              */
/* ------------------------------------------------------------------ */

export type ConnectionKind =
  | "nextjs"
  | "wordpress"
  | "webhook"
  | "linkedin"
  | "telegram"
  | "x"
  | "ghost"
  // wave 2
  | "slack" // incoming webhook URL
  | "discord" // webhook URL
  | "email_smtp" // host, port, user, password, from
  | "rest_api"; // generic API (CRM, Google Sheets via Apps Script, internal): base_url + auth header; host is allowlisted

export interface ConnectionKindInfo {
  kind: ConnectionKind;
  name: string;
  description: string;
  icon: string; // lucide icon name
  auto_publish: boolean; // false = posts are prepared for manual copy (e.g. X without API keys)
  fields: ConfigField[]; // secret fields are write-only
  /** Plain-language setup guide shown as numbered steps before the form. */
  setup_steps: string[];
  docs: string; // relative docs path, e.g. "docs/integrations/nextjs.md"
}

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  config: Record<string, unknown>; // non-secret values only
  secrets_set: string[]; // keys of secret fields that have a value
  status: "connected" | "needs_setup" | "error";
  last_used_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface ConnectionWrite {
  name: string;
  kind: ConnectionKind;
  config?: Record<string, unknown>; // may include secret keys; stored encrypted, never returned
}

export interface ConnectionTestResult {
  ok: boolean;
  detail: string;
  latency_ms: number | null;
}

export type ApiScope = "content:read" | "datasets:read" | "assistant:chat" | "runs:write" | "runs:read";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string; // first chars, e.g. "lf_pk_3f9a"
  scopes: ApiScope[];
  last_used_at: string | null;
  created_at: string;
  revoked: boolean;
}

export interface ApiKeyCreated {
  key: ApiKey;
  secret: string; // shown once
}

/* ------------------------------------------------------------------ */
/* Platform overview (operator home, across all clients)               */
/* ------------------------------------------------------------------ */

export interface ActivityEvent {
  id: string;
  at: string;
  workspace: string; // slug
  workspace_name: string;
  kind: "run" | "content" | "publish" | "dataset" | "agent" | "connection" | "error";
  message: string;
  status: "ok" | "warn" | "error" | "info";
}

export interface ModelInfo {
  name: string; // ollama tag
  role: "writer" | "fast" | "embed";
  size_gb: number | null;
  loaded: boolean;
}

export interface PlatformOverview {
  totals: {
    workspaces: number;
    agents: number;
    pipelines: number;
    runs_24h: number;
    failed_24h: number;
    content_7d: number;
    published_7d: number;
    records: number;
  };
  runs_by_day: { day: string; succeeded: number; failed: number }[]; // last 14 days
  workspaces: Workspace[];
  activity: ActivityEvent[];
  models: ModelInfo[];
  provider: string; // "ollama" | "openai_compat" | "mock"
  queue: { queued: number; running: number };
}

/** GET /dashboard/workspace — home screen of a single workspace. */
export interface WorkspaceDashboard {
  workspace: Workspace;
  runs_by_day: { day: string; succeeded: number; failed: number }[];
  recent_runs: PipelineRun[];
  pending_approval: number;
  recent_content: ContentItem[];
  activity: ActivityEvent[];
}
