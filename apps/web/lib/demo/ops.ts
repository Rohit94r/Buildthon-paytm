// Wave-2/3 demo endpoints (catalogue, agent lifecycle + live events, workflow v2 steps, members, usage per agent,
// audit, notifications, deliveries, platform health, plans, register, unified activity + progress/XP). Built on top
// of the platform mock: it calls handlePlatform for the underlying data so runs, agents and content stay consistent.
import type {
  Achievement,
  ActivityItem,
  AgentsOverview,
  AgentExecution,
  AgentLifecycle,
  AgentOutputs,
  AgentUsage,
  AgentVersion,
  AuditEvent,
  CatalogAgent,
  ExecutionEvent,
  ExecutionEventType,
  InviteResult,
  ManagedAgent,
  Member,
  NotificationItem,
  Permission,
  Plan,
  PlanKey,
  PlatformHealth,
  Role,
  StepOptions,
  ToolInfo,
  WebhookDelivery,
  WorkspaceProgress,
  WorkspaceUsageWithAgents,
} from "../platform-ops-types";
import type {
  Agent,
  AgentKind,
  AgentTestResult,
  AgentType,
  ApiKey,
  ConfigField,
  Connection,
  ConnectionKind,
  ConnectionKindInfo,
  ConnectionTestResult,
  ContentItem,
  Dataset,
  DatasetRecord,
  Paged,
  Pipeline,
  PipelineRun,
  RunStep,
  Workspace,
} from "../platform-types";
import type { Me } from "../types";
import { AGENT_TYPES, CONNECTION_KINDS } from "./catalog";
import catalogFile from "./catalog-agents.json";
import { activationConfig } from "./catalog-presets";
import { DemoError, UNHANDLED, daysAgo, hoursAgo, minutesAgo, minutesFromNow, seeded, uid, type DemoHandler, type DemoMethod, type DemoRequest } from "./core";
import { DEMO_OWNER_ID } from "./newsroom";
import { DEMO_DEFAULT_WORKSPACE, demoWorkspace, demoWorkspaceLites, handlePlatform } from "./platform";

/* ------------------------------------------------------------------ */
/* Catalogue extensions: wave-2 agent kinds + connection kinds          */
/* ------------------------------------------------------------------ */

const model = (def: "fast" | "writer"): ConfigField => ({
  key: "model",
  label: "Model",
  type: "model",
  default: def,
  options: [
    { value: "fast", label: "Fast (qwen2.5:7b)" },
    { value: "writer", label: "Writer (qwen2.5:14b)" },
  ],
});

const WAVE2_TYPES: AgentType[] = [
  {
    kind: "researcher",
    name: "Researcher",
    description: "Searches the web for a question or topic and builds an evidence pack with cited sources.",
    category: "collect",
    icon: "BookOpenText",
    uses_model: true,
    default_model: "writer",
    inputs: "A question, topic or items",
    outputs: "Evidence pack items with sources",
    config_schema: [
      { key: "question", label: "Research question", type: "textarea", required: true, default: "What changed this week in Indian equity markets and why?" },
      { key: "max_sources", label: "Max sources", type: "number", default: 8, min: 2, max: 25 },
      { key: "trusted_domains", label: "Prefer these domains", type: "string_list", default: [] },
      model("writer"),
    ],
  },
  {
    kind: "fact_checker",
    name: "Fact checker",
    description: "Verifies every claim and number against the item's sources and flags anything unsupported.",
    category: "quality",
    icon: "BadgeCheck",
    uses_model: true,
    default_model: "fast",
    inputs: "Items with text and sources",
    outputs: "Items with verified / unsupported / contradicted flags",
    config_schema: [
      { key: "strictness", label: "Strictness", type: "select", default: "balanced", options: [{ value: "lenient", label: "Lenient" }, { value: "balanced", label: "Balanced" }, { value: "strict", label: "Strict (drop on any unsupported number)" }] },
      { key: "drop_unsupported", label: "Drop items with unsupported claims", type: "boolean", default: false },
      model("fast"),
    ],
  },
  {
    kind: "site_auditor",
    name: "Site auditor",
    description: "Crawls a website and reports missing meta tags, titles, H1s, canonicals, OG tags, JSON-LD and broken links.",
    category: "quality",
    icon: "ScanSearch",
    uses_model: false,
    default_model: null,
    inputs: "A site URL",
    outputs: "SEO report (markdown) + one item per issue",
    config_schema: [
      { key: "site_url", label: "Site URL", type: "text", required: true, placeholder: "https://example.com", default: "" },
      { key: "max_pages", label: "Max pages", type: "number", default: 25, min: 1, max: 500 },
      { key: "checks", label: "Checks", type: "multiselect", default: ["meta", "titles", "h1", "canonical", "og", "jsonld", "links"], options: ["meta", "titles", "h1", "canonical", "og", "jsonld", "links"].map((v) => ({ value: v, label: v.toUpperCase() })) },
    ],
  },
  {
    kind: "image_finder",
    name: "Image finder",
    description: "Finds pictures for each item: open-licence libraries first (Openverse, Wikimedia Commons), then the page's own images, with licence, credit, size and a duplicate-proof image hash.",
    category: "collect",
    icon: "Image",
    uses_model: false,
    default_model: null,
    inputs: "Items with URLs or titles",
    outputs: "Items with image_url + data.images (licence, credit, hash)",
    config_schema: [
      { key: "sources", label: "Pages to take images from (optional)", type: "sources", default: [] },
      { key: "search_open_libraries", label: "Search Openverse and Wikimedia Commons", type: "boolean", default: true },
      { key: "write_alt_text", label: "Write alt text for each image", type: "boolean", default: false },
      { key: "min_width", label: "Minimum width (px)", type: "number", default: 1000, min: 200, max: 4000 },
      { key: "require_credit", label: "Only images with a credit line", type: "boolean", default: true },
    ],
  },
  {
    kind: "change_detector",
    name: "Change detector",
    description: "Compares incoming items with a dataset and keeps only what is new or changed, with field diffs.",
    category: "data",
    icon: "GitCompareArrows",
    uses_model: false,
    default_model: null,
    inputs: "Items with data fields",
    outputs: "New / changed items with diffs",
    config_schema: [
      { key: "dataset", label: "Compare with dataset", type: "dataset", required: true, default: null },
      { key: "watch_fields", label: "Fields to watch", type: "string_list", default: [] },
      { key: "emit_unchanged", label: "Also pass unchanged items", type: "boolean", default: false },
    ],
  },
  {
    kind: "http_action",
    name: "HTTP action",
    description: "Calls an allowlisted REST API connection (CRM, Sheets, internal API) with templated JSON.",
    category: "deliver",
    icon: "Webhook",
    uses_model: false,
    default_model: null,
    inputs: "Items",
    outputs: "API responses",
    config_schema: [
      { key: "connections", label: "REST connection", type: "connections", default: [] },
      { key: "method", label: "Method", type: "select", default: "POST", options: ["POST", "PUT", "PATCH"].map((v) => ({ value: v, label: v })) },
      { key: "path", label: "Path", type: "text", default: "/leads" },
      { key: "body_template", label: "Body template (JSON)", type: "textarea", default: '{ "title": "{title}", "url": "{url}" }' },
    ],
  },
  {
    kind: "notifier",
    name: "Notifier",
    description: "Sends a message or digest to Telegram, Slack, Discord, email or a webhook.",
    category: "deliver",
    icon: "BellRing",
    uses_model: false,
    default_model: null,
    inputs: "Items or a run summary",
    outputs: "Delivery receipts",
    config_schema: [
      { key: "connections", label: "Send to", type: "connections", default: [] },
      { key: "mode", label: "Mode", type: "select", default: "digest", options: [{ value: "digest", label: "One digest per run" }, { value: "each", label: "One message per item" }] },
      { key: "template", label: "Message template", type: "textarea", default: "{count} new items:\n{list}" },
    ],
  },
  {
    kind: "report_builder",
    name: "Report builder",
    description: "Summarises items or a run's output into a markdown report saved as content.",
    category: "create",
    icon: "FileBarChart",
    uses_model: true,
    default_model: "writer",
    inputs: "Items",
    outputs: "A markdown report",
    config_schema: [
      { key: "title", label: "Report title", type: "text", default: "Weekly report" },
      { key: "sections", label: "Sections", type: "string_list", default: ["Summary", "Highlights", "Risks", "Next steps"] },
      model("writer"),
    ],
  },
];

for (const t of WAVE2_TYPES) if (!AGENT_TYPES.some((x) => x.kind === t.kind)) AGENT_TYPES.push(t);

const WAVE2_CONN: ConnectionKindInfo[] = [
  {
    kind: "slack",
    name: "Slack",
    description: "Posts messages and daily digests to a Slack channel.",
    icon: "Hash",
    auto_publish: true,
    fields: [{ key: "webhook_url", label: "Incoming webhook URL", type: "text", required: true, secret: true }],
    setup_steps: [
      "In Slack, open Apps and search for “Incoming WebHooks”, then press Add to Slack.",
      "Choose the channel the messages should go to.",
      "Copy the webhook URL Slack shows you.",
      "Paste it below and press Send test message.",
    ],
    docs: "docs/integrations/slack.md",
  },
  {
    kind: "discord",
    name: "Discord",
    description: "Posts messages and digests to a Discord channel.",
    icon: "MessageCircle",
    auto_publish: true,
    fields: [{ key: "webhook_url", label: "Webhook URL", type: "text", required: true, secret: true }],
    setup_steps: [
      "In Discord, open the channel settings (the gear icon) and go to Integrations → Webhooks.",
      "Press New Webhook and give it a name like “LayerFlow”.",
      "Press Copy Webhook URL.",
      "Paste it below and press Send test message.",
    ],
    docs: "docs/integrations/discord.md",
  },
  {
    kind: "email_smtp",
    name: "Email",
    description: "Sends digests and alerts by email from your own mailbox or mail service.",
    icon: "Mail",
    auto_publish: true,
    fields: [
      { key: "host", label: "Mail server (SMTP host)", type: "text", required: true, placeholder: "smtp.gmail.com" },
      { key: "port", label: "Port", type: "number", default: 587 },
      { key: "username", label: "Username", type: "text", required: true },
      { key: "password", label: "Password or app password", type: "text", required: true, secret: true },
      { key: "from", label: "Send from", type: "text", required: true, placeholder: "alerts@example.com" },
      { key: "to", label: "Send to", type: "string_list", default: [] },
    ],
    setup_steps: [
      "Find your mail provider's SMTP settings (for Gmail: smtp.gmail.com, port 587).",
      "Create an app password in your email account's security settings (recommended instead of your real password).",
      "Fill in the server, your email address and the app password below.",
      "Add the people who should receive the emails and press Send test email.",
    ],
    docs: "docs/integrations/email.md",
  },
  {
    kind: "rest_api",
    name: "Other app (REST API)",
    description: "Sends data to any app with an API: your CRM, a Google Sheet (through Apps Script) or your own system.",
    icon: "Braces",
    auto_publish: true,
    fields: [
      { key: "base_url", label: "Base URL", type: "text", required: true, placeholder: "https://api.example.com" },
      { key: "auth_header", label: "Auth header name", type: "text", default: "Authorization" },
      { key: "auth_value", label: "Auth header value", type: "text", secret: true },
    ],
    setup_steps: [
      "Ask the app's admin (or check its developer settings) for the API address and an API key.",
      "For Google Sheets: open Extensions → Apps Script, paste the script from the guide and deploy it as a web app.",
      "Paste the address below, and the key in the auth value field.",
      "Press Test: we send a harmless test request and show the answer.",
    ],
    docs: "docs/integrations/rest-api.md",
  },
];
for (const c of WAVE2_CONN) if (!CONNECTION_KINDS.some((x) => x.kind === c.kind)) CONNECTION_KINDS.push(c);

/* ------------------------------------------------------------------ */
/* Static catalogue data                                                */
/* ------------------------------------------------------------------ */
const PLANS: Plan[] = [
  { key: "free", name: "Free", price_inr_month: 0, description: "Try LayerFlow with a few free agents.", limits: { agents: 3, runs_per_day: 20, concurrent_runs: 1, records: 500, api_calls_per_day: 500, members: 2, premium_agents: false } },
  { key: "starter", name: "Starter", price_inr_month: 2499, description: "For a single site with daily automations.", limits: { agents: 8, runs_per_day: 100, concurrent_runs: 2, records: 5000, api_calls_per_day: 5000, members: 5, premium_agents: false } },
  { key: "pro", name: "Pro", price_inr_month: 7999, description: "Premium agents, more runs and a bigger team.", limits: { agents: 25, runs_per_day: 500, concurrent_runs: 4, records: 50000, api_calls_per_day: 50000, members: 15, premium_agents: true } },
  { key: "business", name: "Business", price_inr_month: 19999, description: "High volume, many sites, priority queue.", limits: { agents: 100, runs_per_day: 2500, concurrent_runs: 10, records: 500000, api_calls_per_day: 250000, members: 50, premium_agents: true } },
  { key: "enterprise", name: "Enterprise", price_inr_month: null, description: "Custom limits, SSO and dedicated workers.", limits: { agents: -1, runs_per_day: -1, concurrent_runs: 25, records: -1, api_calls_per_day: -1, members: -1, premium_agents: true } },
];
const planOf = (k: PlanKey) => PLANS.find((p) => p.key === k) ?? PLANS[0];

/** One catalogue entry as stored in catalog-agents.json (a copy of config/catalog/agents.json). */
type CatalogEntry = Omit<CatalogAgent, "entitled" | "activated_agent_ids" | "kind_category"> & { preset?: Record<string, unknown> };
const CATALOG: CatalogEntry[] = (catalogFile as unknown as { agents: CatalogEntry[] }).agents;

const KIND_ICON: Partial<Record<AgentKind, string>> = {};
for (const t of AGENT_TYPES) KIND_ICON[t.kind] = t.icon;

const TOOLS: ToolInfo[] = (
  [
    ["web.fetch", "Fetch web page", "Downloads a public URL with robots.txt and rate limits respected.", "web", ["network:public"], false],
    ["web.search", "Web search", "Searches the web and returns ranked results.", "web", ["network:public"], false],
    ["rss.read", "Read RSS", "Reads RSS/Atom feeds.", "web", ["network:public"], false],
    ["sitemap.read", "Read sitemap", "Lists URLs from sitemap.xml files.", "web", ["network:public"], false],
    ["links.collect", "Collect links", "Collects, normalises and de-duplicates links from pages and sitemaps.", "web", ["network:public"], false],
    ["html.extract", "HTML extract", "Extracts fields with CSS selectors.", "data", [], false],
    ["ai.extract", "AI extract", "Extracts typed fields from page text with the model.", "ai", ["model:call"], false],
    ["doc.read", "Read document", "Reads text from PDFs and documents.", "data", ["network:public"], false],
    ["suggest.keywords", "Keyword suggestions", "Gets free search-box suggestions for a phrase.", "seo", ["network:public"], false],
    ["seo.analyze", "SEO analyse", "Checks titles, meta, headings, canonicals and structured data.", "seo", [], false],
    ["dataset.read", "Read dataset", "Reads records from a workspace dataset.", "data", ["dataset:read"], false],
    ["dataset.upsert", "Upsert records", "Creates or updates dataset records by key.", "data", ["dataset:write"], false],
    ["content.save", "Save content", "Saves content items and variants.", "data", ["content:write"], false],
    ["publish.connection", "Publish to connection", "Publishes content to a connected site or channel.", "publish", ["external:side_effect"], true],
    ["http.request", "HTTP request", "Calls an allowlisted REST connection.", "integration", ["external:side_effect"], true],
    ["notify.send", "Send notification", "Sends a message to Slack, Discord, Telegram or email.", "notify", ["external:side_effect"], true],
    ["image.discover", "Discover image", "Finds images on pages and in open-licence libraries, with credits.", "web", ["network:public"], false],
    ["image.hash", "Image hash", "Computes a perceptual hash so the same picture is never used twice.", "data", [], false],
    ["model.generate", "Model generate", "Generates text with the workspace model.", "ai", ["model:call"], false],
    ["serpapi.search", "SerpApi live search", "Real-time Google Web / News / Jobs / Shopping / Maps / Scholar results.", "web", ["network:public"], false],
    ["serpapi.extract", "SerpApi Extract", "Full page markdown from a URL via SerpApi.", "web", ["network:public"], false],
    ["you.search", "You.com live search", "Real-time web results from You.com.", "web", ["network:public"], false],
    ["you.answer", "You.com cited answer", "Synthesized answer with numbered citations from You.com.", "ai", ["network:public"], false],
  ] as const
).map(([key, name, description, category, permissions, side]) => ({
  key,
  name,
  description,
  version: "1.0.0",
  category,
  input_schema: { type: "object" },
  output_schema: { type: "object" },
  permissions: [...permissions],
  requires_connection: key === "publish.connection" ? (["nextjs", "wordpress", "linkedin", "telegram", "x", "webhook"] as ConnectionKind[]) : key === "notify.send" ? (["slack", "discord", "telegram", "email_smtp"] as ConnectionKind[]) : key === "http.request" ? (["rest_api"] as ConnectionKind[]) : null,
  timeout_s: side ? 30 : 20,
  retries: side ? 3 : 2,
  side_effects: side,
}));

const TOOLS_BY_KIND: Record<AgentKind, string[]> = {
  web_scraper: ["web.fetch", "rss.read", "sitemap.read", "html.extract", "ai.extract"],
  news_monitor: ["rss.read", "web.search", "web.fetch"],
  persona_rewriter: ["model.generate"],
  multi_format: ["model.generate", "content.save"],
  seo_optimizer: ["seo.analyze", "model.generate"],
  quality_gate: ["model.generate"],
  data_transform: ["model.generate"],
  auto_publisher: ["publish.connection"],
  dataset_builder: ["web.fetch", "ai.extract", "dataset.upsert"],
  comparison_assistant: ["dataset.read", "model.generate"],
  custom_llm: ["model.generate"],
  researcher: ["web.search", "web.fetch", "model.generate"],
  fact_checker: ["web.fetch", "model.generate"],
  site_auditor: ["sitemap.read", "web.fetch", "seo.analyze"],
  image_finder: ["image.discover", "image.hash", "web.fetch"],
  change_detector: ["dataset.read"],
  http_action: ["http.request"],
  notifier: ["notify.send"],
  report_builder: ["model.generate", "content.save"],
  link_collector: ["web.fetch", "sitemap.read", "links.collect"],
  document_reader: ["web.fetch", "doc.read", "ai.extract"],
  page_watcher: ["web.fetch", "html.extract"],
  keyword_researcher: ["suggest.keywords", "web.fetch"],
  comparer: ["dataset.read", "content.save"],
  serpapi_search: ["serpapi.search", "serpapi.extract"],
  you_research: ["you.answer", "you.search"],
};
const PERMS: Record<Role, Permission[]> = {
  owner: ["workspace.manage", "members.manage", "agents.manage", "agents.run", "content.approve", "integrations.manage", "data.edit", "view"],
  admin: ["workspace.manage", "members.manage", "agents.manage", "agents.run", "content.approve", "integrations.manage", "data.edit", "view"],
  developer: ["agents.manage", "agents.run", "integrations.manage", "data.edit", "view"],
  operator: ["agents.run", "content.approve", "data.edit", "view"],
  analyst: ["view"],
  viewer: ["view"],
};

const SEED_PLAN: Record<string, PlanKey> = { marketpulse: "pro", collegecompass: "business", hackfinder: "starter", ten: "enterprise" };

/* ------------------------------------------------------------------ */
/* Ops store (per workspace)                                            */
/* ------------------------------------------------------------------ */

interface AgentMeta {
  status: ManagedAgent["status"];
  source: ManagedAgent["source"];
  catalog_key: string | null;
  every_minutes: number | null;
  requires_approval: boolean;
  limits: ManagedAgent["limits"];
  versions: AgentVersion[];
  soloPipelineId: string | null;
}

interface OpsStore {
  agents: Map<string, AgentMeta>;
  stepOpts: Map<string, StepOptions>; // step id -> options
  approvals: Map<string, { id: string; index: number; label: string | null }[]>; // pipeline id -> approval steps
  pipelineVersions: Map<string, { version: number; steps: unknown[]; trigger: unknown; created_by: string | null; created_at: string }[]>;
  members: Member[];
  audit: AuditEvent[];
  readNotifs: Set<string>;
  allRead: number;
  events: ExecutionEvent[];
  eventKeys: Set<string>;
  deliveries: Map<string, WebhookDelivery[]>;
  plan: PlanKey;
  status: "active" | "suspended";
  onboarding: boolean;
  website: string | null;
  /** Unified activity feed (insertion order; served newest first). */
  activity: ActivityItem[];
  actKeys: Set<string>;
  actSeeded: boolean;
  /** Days (workspace timezone) with at least one successful run in the log. */
  okDays: Set<string>;
  /** Connections that already earned their one-time "connected" XP. */
  awardedConns: Set<string>;
}

const stores = new Map<string, OpsStore>();
let eventSeq = 1;
const ME_EMAIL = "rohit@layerflow.dev";

function ops(slug: string): OpsStore {
  let s = stores.get(slug);
  if (!s) {
    const ws = demoWorkspace(slug);
    const rng = seeded(`members-${slug}`);
    const domain = ws?.domain ?? "example.com";
    const people: [string, string, Role][] = [
      ["Rohit Mehra", ME_EMAIL, "owner"],
      ["Ananya Iyer", `ananya@${domain}`, "admin"],
      ["Karan Shah", `karan@${domain}`, "developer"],
      ["Meera Pillai", `meera@${domain}`, "operator"],
      ["Arjun Rao", `arjun@${domain}`, "viewer"],
    ];
    const isNew = !SEED_PLAN[slug];
    s = {
      agents: new Map(),
      stepOpts: new Map(),
      approvals: new Map(),
      pipelineVersions: new Map(),
      members: (isNew ? people.slice(0, 1) : people).map(([name, email, role], i) => ({
        id: `mem_${slug}_${i}`,
        user_id: i === 0 ? DEMO_OWNER_ID : `usr_${slug}_${i}`,
        email,
        name,
        role,
        status: i === 4 ? "invited" : "active",
        last_login_at: i === 4 ? null : hoursAgo(Math.round(rng() * 60) + i),
        created_at: daysAgo(40 - i * 5),
      })),
      audit: [],
      readNotifs: new Set(),
      allRead: 0,
      events: [],
      eventKeys: new Set(),
      deliveries: new Map(),
      // new workspaces start on Starter so several free agents can be activated right away
      plan: SEED_PLAN[slug] ?? "starter",
      status: "active",
      onboarding: false,
      website: ws?.domain ? `https://${ws.domain}` : null,
      activity: [],
      actKeys: new Set(),
      actSeeded: isNew,
      okDays: new Set(),
      awardedConns: new Set(),
    };
    if (!isNew) {
      const seedAudit: [number, string, string, string][] = [
        [30, ME_EMAIL, "workspace.created", "workspace"],
        [29, ME_EMAIL, "agent.activated", "agent"],
        [12, `ananya@${domain}`, "member.invited", "member"],
        [6, `karan@${domain}`, "agent.updated", "agent"],
        [3, ME_EMAIL, "api_key.created", "api_key"],
        [1, "system", "connection.tested", "connection"],
      ];
      s.audit = seedAudit.map(([d, actor, action, entity]) => ({ id: uid("aud_"), at: daysAgo(d), actor, action, entity, entity_id: null, detail: {} }));
    }
    stores.set(slug, s);
  }
  return s;
}

function audit(slug: string, action: string, entity: string, entity_id: string | null, detail: Record<string, unknown> = {}) {
  ops(slug).audit.unshift({ id: uid("aud_"), at: new Date().toISOString(), actor: ME_EMAIL, action, entity, entity_id, detail });
}

/* Calls into the platform mock with a derived request. */
function P<T>(req: DemoRequest, method: DemoMethod, path: string, body?: unknown, query: Record<string, string> = {}): T {
  const out = handlePlatform({ ...req, method, path, segments: path.split("/").filter(Boolean), query, body });
  if (out === UNHANDLED) throw new DemoError(404, "not_found", `No route ${path}`);
  return out as T;
}

const SOLO = "__agent__:";

function meta(req: DemoRequest, a: Agent): AgentMeta {
  const s = ops(req.workspace);
  let m = s.agents.get(a.id);
  if (!m) {
    const seededAgent = Date.now() - new Date(a.created_at).getTime() > 60 * 60_000;
    const every = a.kind === "news_monitor" || a.kind === "web_scraper" ? 60 : a.kind === "dataset_builder" ? 1440 : null;
    m = {
      status: a.enabled ? "active" : "disabled",
      source: "custom",
      catalog_key: null,
      every_minutes: seededAgent ? every : null,
      requires_approval: a.kind === "auto_publisher",
      limits: { max_items: 50, timeout_s: 300, max_retries: 2 },
      versions: [],
      soloPipelineId: null,
    };
    m.versions.push({ version: 1, config: JSON.parse(JSON.stringify(a.config)), model: a.model, note: "Initial version", created_by: ME_EMAIL, created_at: a.created_at });
    if (seededAgent) {
      m.versions.push({ version: 2, config: JSON.parse(JSON.stringify(a.config)), model: a.model, note: "Tuned limits", created_by: ME_EMAIL, created_at: a.updated_at });
    }
    s.agents.set(a.id, m);
  }
  return m;
}

function runsFor(req: DemoRequest): PipelineRun[] {
  return P<{ items: PipelineRun[] }>(req, "GET", "/runs", undefined, { limit: "500" }).items;
}

function managed(req: DemoRequest, a: Agent, runs?: PipelineRun[]): ManagedAgent {
  const m = meta(req, a);
  const all = runs ?? runsFor(req);
  let live: AgentLifecycle["live"] = null;
  let lastError: string | null = null;
  for (const r of all) {
    for (const st of r.steps) {
      if (st.agent_id !== a.id) continue;
      if (st.status === "running" && !live) live = { run_id: r.id, started_at: st.started_at ?? r.created_at, message: st.logs[st.logs.length - 1]?.message ?? "Starting…" };
      if (st.status === "failed" && !lastError) lastError = st.error;
    }
  }
  const lc: AgentLifecycle = {
    status: m.status,
    version: m.versions.length,
    source: m.source,
    catalog_key: m.catalog_key,
    package_key: null,
    schedule: { every_minutes: m.every_minutes, next_run_at: m.every_minutes && m.status === "active" ? minutesFromNow(Math.max(3, Math.round(m.every_minutes * 0.37))) : null },
    requires_approval: m.requires_approval,
    limits: m.limits,
    tools: TOOLS_BY_KIND[a.kind] ?? ["model.generate"],
    live,
    last_error: lastError,
  };
  return { ...a, ...lc };
}

/* ------------------------------------------------------------------ */
/* Execution events, derived from the (time-driven) mock runs           */
/* ------------------------------------------------------------------ */

const KIND_LOGS: Partial<Record<AgentKind, (n: number) => string[]>> = {
  researcher: (n) => [`Searched the web · ${n + 9} results`, `Read ${Math.min(8, n + 4)} sources`, `Built evidence pack with ${n + 6} cited facts`],
  fact_checker: (n) => [`Extracted ${n * 3 + 4} claims`, `Verified ${n * 3 + 2} claims against sources`, `2 claims unsupported → flagged`],
  site_auditor: () => ["Crawled 25 pages", "8 missing meta descriptions", "3 duplicate title tags · 2 pages without H1", "Report saved"],
  image_finder: (n) => [`Checked ${n} source pages for images`, `Found ${Math.max(1, n - 1)} lead images ≥ 1000px with credits`],
  change_detector: (n) => [`Compared ${n} items with dataset`, `${Math.max(1, Math.round(n / 4))} new · ${Math.max(1, Math.round(n / 5))} changed · rest unchanged`],
  http_action: (n) => [`POST /leads × ${n}`, `${n} × 201 Created · avg 240 ms`],
  notifier: (n) => [`Built digest of ${n} items`, "Delivered to #alerts (200 OK)"],
  report_builder: (n) => [`Summarised ${n} items`, "Report saved as content (1,240 words)"],
  link_collector: (n) => ["Read 2 start pages + sitemap.xml", `Collected ${Math.round(n * 2.4) + 4} links · kept ${n} matching /product/`, `Removed ${Math.round(n * 0.3)} duplicates and tracking parameters`],
  document_reader: (n) => ["Downloaded fees-2026.pdf (1.8 MB)", "Read 14 pages from fees-2026.pdf", `Extracted 3 fields with qwen2.5:7b-instruct · ${n} item${n === 1 ? "" : "s"}`],
  page_watcher: (n) => [`Checked ${Math.max(3, n)} pages`, `${Math.min(n, 2) === 1 ? "1 changed" : `${Math.min(n, 2)} changed`}: price ₹54,999 → ₹51,999`],
  keyword_researcher: (n) => ["Fetched search suggestions for 3 seed keywords", "Read 4 competitor pages for extra terms", `${Math.max(n, 142)} ideas in 4 intent groups`],
  comparer: (n) => [`Matched ${Math.max(6, Math.round(n / 3))} products across 3 shops`, "Best price at Croma for 4 of them · Amazon for 2"],
  serpapi_search: (n) => [`SerpApi query sent (engine: google)`, `${n} structured result${n === 1 ? "" : "s"} de-duplicated by URL`, "Cached for 5 minutes to save credits"],
  you_research: (n) => [`You.com Answer API returned a cited answer`, `${n} inline citations mapped to source URLs`, "Answer saved with sources for the assistant"],
};

const TOOL_FOR_LOG: [RegExp, string][] = [
  [/rss|feed/i, "rss.read"],
  [/fetch|crawl|page/i, "web.fetch"],
  [/search/i, "web.search"],
  [/extract/i, "ai.extract"],
  [/upsert|record|dataset/i, "dataset.upsert"],
  [/publish|post(ed)? to|deliver|telegram|linkedin|wordpress|next\.js/i, "publish.connection"],
];

function deriveEvents(slug: string, runs: PipelineRun[]) {
  const s = ops(slug);
  const fresh: ExecutionEvent[] = [];
  const push = (key: string, at: string | null, ev: Omit<ExecutionEvent, "id" | "at">) => {
    if (!at || s.eventKeys.has(key)) return;
    s.eventKeys.add(key);
    fresh.push({ id: 0, at, ...ev });
  };
  for (const r of [...runs].reverse()) {
    const base = { run_id: r.id, step_id: null, agent_id: null, agent_name: null, level: "info" as const, data: {} };
    push(`${r.id}:queued`, r.created_at, { ...base, type: "run.queued", message: `Run queued · ${r.pipeline_name}`, data: { trigger: r.trigger } });
    if (r.started_at) push(`${r.id}:started`, r.started_at, { ...base, type: "run.started", message: `Run started · ${r.steps.length} step${r.steps.length === 1 ? "" : "s"}` });
    r.steps.forEach((st, i) => {
      const sb = { run_id: r.id, step_id: st.step_id, agent_id: st.agent_id, agent_name: st.agent_name, data: {} as Record<string, unknown> };
      if (st.status === "skipped") {
        push(`${r.id}:${i}:skipped`, st.finished_at ?? r.finished_at ?? r.created_at, { ...sb, level: "warn", type: "step.skipped", message: `${st.agent_name} skipped`, data: { reason: st.error ?? "condition not met" } });
        return;
      }
      if (!st.started_at) return;
      push(`${r.id}:${i}:start`, st.started_at, { ...sb, level: "info", type: "step.started", message: `${st.agent_name} started`, data: { items_in: st.items_in } });
      const custom = KIND_LOGS[st.kind as AgentKind];
      const lines = custom ? custom(Math.max(st.items_in, st.items_out, 3)) : st.logs.map((l) => l.message);
      const t0 = new Date(st.started_at).getTime();
      const t1 = st.finished_at ? new Date(st.finished_at).getTime() : Date.now();
      const visible = st.finished_at ? lines.length : Math.max(1, Math.min(lines.length, st.logs.length || 1));
      lines.slice(0, visible).forEach((msg, j) => {
        const at = custom ? new Date(t0 + ((j + 1) / (lines.length + 1)) * Math.max(500, t1 - t0)).toISOString() : (st.logs[j]?.at ?? st.started_at);
        const tool = TOOL_FOR_LOG.find(([re]) => re.test(msg))?.[1];
        const lvl = custom ? "info" : (st.logs[j]?.level ?? "info");
        if (tool) push(`${r.id}:${i}:tool:${j}`, at, { ...sb, level: lvl, type: "tool.called", message: msg, data: { tool, duration_ms: 180 + ((j * 137) % 900) } });
        else if (/model|rewrote|wrote|generated|summar/i.test(msg)) push(`${r.id}:${i}:model:${j}`, at, { ...sb, level: lvl, type: "model.called", message: msg, data: { model: "qwen2.5:7b-instruct" } });
        else push(`${r.id}:${i}:log:${j}`, at, { ...sb, level: lvl, type: "step.log", message: msg, data: {} });
      });
      if (st.status === "succeeded" && st.finished_at)
        push(`${r.id}:${i}:done`, st.finished_at, { ...sb, level: "info", type: "step.finished", message: `${st.agent_name} finished · ${st.items_in} → ${st.items_out} items`, data: { items_in: st.items_in, items_out: st.items_out, duration_ms: st.duration_ms } });
      if (st.status === "failed")
        push(`${r.id}:${i}:fail`, st.finished_at ?? r.finished_at ?? new Date().toISOString(), { ...sb, level: "error", type: "step.failed", message: `${st.agent_name} failed`, data: { error: st.error } });
    });
    const endAt = r.finished_at;
    const end: Partial<Record<string, [ExecutionEventType, ExecutionEvent["level"], string]>> = {
      succeeded: ["run.finished", "info", `Run finished · ${r.items_out} items · ${r.content_created} content`],
      failed: ["run.failed", "error", `Run failed${r.error ? ` · ${r.error}` : ""}`],
      cancelled: ["run.cancelled", "warn", "Run cancelled"],
    };
    const e = end[r.status];
    if (e && endAt) push(`${r.id}:end`, endAt, { ...base, type: e[0], level: e[1], message: e[2] });
    if (r.status === "awaiting_approval") {
      const last = r.steps.filter((x) => x.finished_at).map((x) => x.finished_at as string).sort().pop() ?? r.created_at;
      push(`${r.id}:approval`, last, { ...base, type: "run.awaiting_approval", level: "warn", message: "Waiting for approval before publishing" });
    }
  }
  fresh.sort((a, b) => a.at.localeCompare(b.at));
  for (const ev of fresh) {
    ev.id = eventSeq++;
    s.events.push(ev);
  }
  if (s.events.length > 3000) s.events = s.events.slice(-3000);
}

function eventsFor(req: DemoRequest, filter: (e: ExecutionEvent) => boolean): { items: ExecutionEvent[] } {
  const runs = runsFor(req);
  deriveEvents(req.workspace, runs);
  const after = Number(req.query.after ?? 0) || 0;
  const limit = Math.min(500, Number(req.query.limit ?? 100) || 100);
  const items = ops(req.workspace).events.filter((e) => e.id > after && filter(e));
  return { items: after ? items.slice(0, limit) : items.slice(-limit) };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function catalogFor(req: DemoRequest, agents: Agent[]): CatalogAgent[] {
  const s = ops(req.workspace);
  const plan = planOf(s.plan);
  return CATALOG.map(({ preset: _preset, ...c }) => {
    void _preset;
    const type = AGENT_TYPES.find((t) => t.kind === c.kind);
    const entitled = c.pricing.tier === "free" || (c.pricing.tier === "pro" && plan.limits.premium_agents) || (c.pricing.tier === "enterprise" && s.plan === "enterprise");
    return {
      ...c,
      kind_category: type?.category ?? "create",
      icon: c.icon || KIND_ICON[c.kind] || "Sparkles",
      tools: c.tools?.length ? c.tools : (TOOLS_BY_KIND[c.kind] ?? []),
      entitled,
      activated_agent_ids: agents.filter((a) => s.agents.get(a.id)?.catalog_key === c.key).map((a) => a.id),
    };
  });
}

function stepView(s: OpsStore, p: Pipeline): Pipeline {
  const steps = p.steps.map((st) => ({ ...st, type: "agent", ...(s.stepOpts.get(st.id) ?? {}) })) as Pipeline["steps"];
  for (const ap of s.approvals.get(p.id) ?? []) {
    steps.splice(Math.min(ap.index, steps.length), 0, { id: ap.id, agent_id: "", agent_name: ap.label ?? "Human approval", type: "approval", label: ap.label } as unknown as Pipeline["steps"][number]);
  }
  return { ...p, steps };
}

type StepIn = { id?: string; agent_id?: string; overrides?: Record<string, unknown> } & StepOptions;

function splitSteps(slug: string, pipelineId: string | null, raw: StepIn[]): { agentSteps: StepIn[]; approvals: { id: string; index: number; label: string | null }[] } {
  const s = ops(slug);
  const agentSteps: StepIn[] = [];
  const approvals: { id: string; index: number; label: string | null }[] = [];
  raw.forEach((st) => {
    if (st.type === "approval") approvals.push({ id: st.id || uid("apv_"), index: agentSteps.length + approvals.length, label: st.label ?? null });
    else {
      const id = st.id || uid("stp_");
      s.stepOpts.set(id, { type: "agent", condition: st.condition ?? null, on_error: st.on_error ?? "stop", retries: st.retries, label: st.label ?? null });
      agentSteps.push({ id, agent_id: st.agent_id, overrides: st.overrides });
    }
  });
  void pipelineId;
  return { agentSteps, approvals };
}

function recordPipelineVersion(slug: string, p: Pipeline) {
  const s = ops(slug);
  const list = s.pipelineVersions.get(p.id) ?? [];
  list.push({ version: list.length + 1, steps: JSON.parse(JSON.stringify(stepView(s, p).steps)), trigger: p.trigger, created_by: ME_EMAIL, created_at: new Date().toISOString() });
  s.pipelineVersions.set(p.id, list);
}

function decorateRun(s: OpsStore, r: PipelineRun, pipelines: Pipeline[]): PipelineRun {
  const p = pipelines.find((x) => x.id === r.pipeline_id);
  let out: PipelineRun = { ...r, agent_id: null, steps: r.steps.map((x) => ({ ...x, type: "agent" as const, label: x.label ?? null, attempts: x.attempts ?? (x.status === "failed" ? 3 : x.status === "pending" ? 0 : 1) })) };
  if (r.pipeline_name.startsWith(SOLO)) out = { ...out, pipeline_name: `${r.pipeline_name.slice(SOLO.length)} · single run`, pipeline_id: null, agent_id: r.steps[0]?.agent_id ?? null };
  const approvals = p ? (s.approvals.get(p.id) ?? []) : [];
  if (!approvals.length) return out;
  const steps: (RunStep & { type?: string; label?: string | null })[] = out.steps.map((st) => ({ ...st, type: "agent" }));
  for (const ap of approvals) {
    const idx = Math.min(ap.index, steps.length);
    const before = steps.slice(0, idx);
    const prevDone = before.every((x) => x.status === "succeeded" || x.status === "skipped");
    const after = steps.slice(idx);
    const afterStarted = after.some((x) => x.status !== "pending");
    const status: RunStep["status"] =
      out.status === "awaiting_approval" && prevDone && !afterStarted ? "running" : afterStarted || out.status === "succeeded" ? "succeeded" : out.status === "failed" || out.status === "cancelled" ? "skipped" : "pending";
    const at = before[before.length - 1]?.finished_at ?? null;
    steps.splice(idx, 0, {
      step_id: ap.id,
      agent_id: "",
      agent_name: ap.label ?? "Human approval",
      kind: "approval",
      type: "approval",
      attempts: 0,
      label: ap.label,
      status,
      started_at: status === "pending" ? null : at,
      finished_at: status === "succeeded" ? (after.find((x) => x.started_at)?.started_at ?? out.finished_at) : null,
      duration_ms: null,
      items_in: 0,
      items_out: 0,
      logs: status === "running" ? [{ at: at ?? out.created_at, level: "warn", message: "Waiting for a reviewer to approve" }] : status === "succeeded" ? [{ at: at ?? out.created_at, level: "info", message: `Approved by ${ME_EMAIL}` }] : [],
      error: null,
    });
  }
  return { ...out, steps };
}

function notifications(req: DemoRequest): { items: NotificationItem[]; unread: number } {
  const s = ops(req.workspace);
  const runs = runsFor(req);
  const items: NotificationItem[] = [];
  for (const r of runs.slice(0, 40)) {
    if (r.status === "awaiting_approval")
      items.push({ id: `n_apv_${r.id}`, at: r.steps.map((x) => x.finished_at ?? "").sort().pop() || r.created_at, kind: "approval_needed", title: "Approval needed", body: `${r.pipeline_name.replace(SOLO, "")} is waiting for you to approve ${r.content_created || "new"} draft${r.content_created === 1 ? "" : "s"}.`, link: `/runs/${r.id}`, read: false });
    if (r.status === "failed") items.push({ id: `n_fail_${r.id}`, at: r.finished_at ?? r.created_at, kind: "run_failed", title: "Run failed", body: `${r.pipeline_name.replace(SOLO, "")}: ${r.error ?? "a step failed"}`, link: `/runs/${r.id}`, read: false });
  }
  const conns = P<{ items: Connection[] }>(req, "GET", "/connections").items;
  for (const c of conns) if (c.status === "error") items.push({ id: `n_conn_${c.id}`, at: c.last_used_at ?? c.created_at, kind: "connection_error", title: `${c.name} needs attention`, body: c.last_error ?? "The last delivery failed.", link: "/connections", read: false });
  items.push({ id: "n_welcome", at: daysAgo(6), kind: "info", title: "New in LayerFlow: approval steps", body: "Add an Approval step anywhere in a workflow to pause it for a human.", link: "/pipelines", read: false });
  for (const n of items) n.read = s.readNotifs.has(n.id) || new Date(n.at).getTime() <= s.allRead;
  items.sort((a, b) => b.at.localeCompare(a.at));
  return { items: items.slice(0, 30), unread: items.filter((n) => !n.read).length };
}

function usesModel(kind: string): boolean {
  return !!AGENT_TYPES.find((t) => t.kind === kind)?.uses_model;
}

/** Per-agent usage for the current month, computed from the run steps. */
function usageByAgent(req: DemoRequest, runs: PipelineRun[], since: number): AgentUsage[] {
  const s = ops(req.workspace);
  const agents = P<{ items: Agent[] }>(req, "GET", "/agents").items;
  const rows = new Map<string, AgentUsage & { _dur: number; _n: number }>();
  for (const a of agents)
    rows.set(a.id, { agent_id: a.id, name: a.name, kind: a.kind, catalog_key: s.agents.get(a.id)?.catalog_key ?? null, runs: 0, succeeded: 0, failed: 0, items_out: 0, model_calls: 0, model_tokens: 0, tool_calls: 0, avg_duration_ms: null, last_run_at: null, _dur: 0, _n: 0 });
  for (const r of runs) {
    if (new Date(r.created_at).getTime() < since) continue;
    for (const st of r.steps) {
      const row = rows.get(st.agent_id);
      if (!row || !st.started_at) continue;
      if (!row.last_run_at || st.started_at > row.last_run_at) row.last_run_at = st.started_at;
      if (st.status !== "succeeded" && st.status !== "failed") continue;
      row.runs++;
      if (st.status === "succeeded") row.succeeded++;
      else row.failed++;
      row.items_out += st.items_out;
      const work = Math.max(1, st.items_in, st.items_out);
      if (usesModel(st.kind)) {
        const calls = st.kind === "data_transform" ? 1 : Math.max(1, Math.min(work, 60));
        row.model_calls += calls;
        row.model_tokens += calls * (st.kind === "multi_format" || st.kind === "persona_rewriter" ? 2600 : 1100);
      }
      const tools = TOOLS_BY_KIND[st.kind as AgentKind] ?? [];
      row.tool_calls += tools.filter((t) => t !== "model.generate").length * Math.max(1, Math.ceil(work / 10));
      if (st.duration_ms !== null) {
        row._dur += st.duration_ms;
        row._n++;
      }
    }
  }
  return [...rows.values()]
    .map(({ _dur, _n, ...row }) => ({ ...row, avg_duration_ms: _n ? Math.round(_dur / _n) : null }))
    .sort((a, b) => b.runs - a.runs || (b.last_run_at ?? "").localeCompare(a.last_run_at ?? "") || a.name.localeCompare(b.name));
}

function usage(req: DemoRequest): WorkspaceUsageWithAgents {
  const s = ops(req.workspace);
  const ws = P<Workspace>(req, "GET", `/workspaces/${req.workspace}`);
  const runs = runsFor(req);
  const rng = seeded(`usage-${req.workspace}`);
  const seededWs = !!SEED_PLAN[req.workspace];
  const scale = { free: 1, starter: 4, pro: 14, business: 30, enterprise: 22 }[s.plan];
  const by_day = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const real = runs.filter((r) => r.created_at.slice(0, 10) === day).length;
    // seeded workspaces get a believable history; new ones show only what really happened
    const r = seededWs ? Math.max(real, Math.round(scale * (0.6 + rng()))) : real;
    return { day, runs: r, model_tokens: r * Math.round(9000 + rng() * 6000), api_calls: Math.round(r * (20 + rng() * 40)) };
  });
  const sum = (k: "runs" | "model_tokens" | "api_calls") => by_day.reduce((a, d) => a + d[k], 0);
  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const by_agent = usageByAgent(req, runs, periodStart.getTime());
  const realItems = by_agent.reduce((n, a) => n + a.items_out, 0);
  return {
    plan: planOf(s.plan),
    period_start: periodStart.toISOString(),
    usage: {
      agents: ws.stats.agents,
      members: s.members.length,
      records: ws.stats.records,
      runs_today: by_day[29].runs,
      runs_month: sum("runs"),
      running_now: runs.filter((r) => r.status === "running" || r.status === "queued").length,
      api_calls_today: by_day[29].api_calls,
      model_calls_month: seededWs ? sum("runs") * 7 : by_agent.reduce((n, a) => n + a.model_calls, 0),
      model_tokens_month: seededWs ? sum("model_tokens") : by_agent.reduce((n, a) => n + a.model_tokens, 0),
      items_processed_month: seededWs ? Math.max(sum("runs") * 23, realItems) : realItems,
    },
    by_day,
    by_agent,
    billing_note: "Payments are not connected yet. Plan changes are made by a LayerFlow platform admin; nothing is charged automatically.",
  };
}

/* ------------------------------------------------------------------ */
/* Unified activity feed + progress (XP, levels, streaks)               */
/* ------------------------------------------------------------------ */

/** THE xp rule table: used to award `xp` on activity items and to build /progress.xp_rules. */
const XP = {
  run_succeeded: { action: "A run finishes successfully", points: 10 },
  items_10: { action: "Each item an agent processes (up to 200 per run)", points: 1 },
  first_run_today: { action: "", points: 0 },
  content_approved: { action: "Handle an approval (approve or reject)", points: 5 },
  content_published: { action: "Publish a piece of content", points: 25 },
  agent_activated: { action: "Activate an agent from the catalogue", points: 15 },
  agent_created: { action: "", points: 0 },
  connection_ok: { action: "Get a website or channel connection working", points: 20 },
  member_invited: { action: "", points: 0 },
  dataset_created: { action: "", points: 0 },
  records_saved: { action: "Save a dataset record", points: 1 },
} as const;
type XpRule = keyof typeof XP;
const ITEMS_XP_CAP = 200;

const LEVELS: { level: number; name: string; at: number }[] = [
  { level: 1, name: "Getting started", at: 0 },
  { level: 2, name: "Explorer", at: 150 },
  { level: 3, name: "Automator", at: 400 },
  { level: 4, name: "Pro operator", at: 900 },
  { level: 5, name: "Power user", at: 1800 },
  { level: 6, name: "Agent master", at: 3500 },
  { level: 7, name: "Automation legend", at: 7000 },
  { level: 8, name: "LayerFlow hero", at: 14000 },
];

function runXp(processed: number, firstToday: boolean): number {
  return XP.run_succeeded.points + Math.min(ITEMS_XP_CAP, processed * XP.items_10.points) + (firstToday ? XP.first_run_today.points : 0);
}

/** Typical manual minutes per item, by engine (estimate for "time saved"). */
const MINUTES_PER_ITEM: Partial<Record<string, number>> = {
  news_monitor: 0.5, web_scraper: 1, link_collector: 0.2, document_reader: 6, page_watcher: 3, researcher: 8, persona_rewriter: 6, multi_format: 8,
  seo_optimizer: 2, quality_gate: 1, fact_checker: 4, data_transform: 0.3, dataset_builder: 1, image_finder: 3, keyword_researcher: 0.5, comparer: 4,
  site_auditor: 2, change_detector: 0.5, auto_publisher: 2, notifier: 1, http_action: 1, report_builder: 20, custom_llm: 4, comparison_assistant: 1,
  serpapi_search: 4, you_research: 25,
};

const dayFmt = new Map<string, Intl.DateTimeFormat>();
function dayIn(at: string | number, tz: string): string {
  let f = dayFmt.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
    }
    dayFmt.set(tz, f);
  }
  return f.format(new Date(at));
}
const shiftDay = (key: string, delta: number) => new Date(Date.parse(`${key}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

/** Milliseconds since local midnight in `tz` for the instant `t`. */
function msIntoDay(t: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
    const g = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
    return ((g("hour") * 60 + g("minute")) * 60 + g("second")) * 1000;
  } catch {
    const d = new Date(t);
    return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000;
  }
}

function tzOf(slug: string): string {
  return demoWorkspace(slug)?.timezone ?? "Asia/Kolkata";
}

function userName(slug: string): string {
  return ops(slug).members.find((m) => m.user_id === DEMO_OWNER_ID)?.name ?? "You";
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type ActInput = Pick<ActivityItem, "category" | "type" | "title"> & Partial<Omit<ActivityItem, "id" | "category" | "type" | "title">>;

/** Appends one item to the workspace feed (once per `key`, when given). */
function pushAct(slug: string, a: ActInput, key?: string): ActivityItem | null {
  const s = ops(slug);
  if (key) {
    if (s.actKeys.has(key)) return null;
    s.actKeys.add(key);
  }
  const item: ActivityItem = {
    id: uid("act_"),
    at: a.at ?? new Date().toISOString(),
    category: a.category,
    type: a.type,
    level: a.level ?? "info",
    title: a.title,
    detail: a.detail ?? null,
    actor: a.actor ?? null,
    agent_id: a.agent_id ?? null,
    run_id: a.run_id ?? null,
    link: a.link ?? null,
    xp: a.xp ?? 0,
    metrics: a.metrics ?? {},
  };
  s.activity.push(item);
  if (item.type === "run.finished") s.okDays.add(dayIn(item.at, tzOf(slug)));
  return item;
}

/** A user action in the active workspace (actor = the signed-in person). Makes sure history is seeded first. */
function act(req: DemoRequest, a: ActInput, key?: string): ActivityItem | null {
  ensureActivity(req);
  return pushAct(req.workspace, { actor: userName(req.workspace), ...a }, key);
}

const runName = (r: { pipeline_name: string }) => (r.pipeline_name.startsWith(SOLO) ? r.pipeline_name.slice(SOLO.length) : r.pipeline_name);

type RunLike = Pick<PipelineRun, "id" | "pipeline_id" | "pipeline_name" | "status" | "trigger" | "finished_at" | "created_at" | "items_out" | "content_created" | "error" | "steps">;

/** Activity items for one run (end state + the interesting steps). `synthetic` = seeded history (no run page). */
function logRun(slug: string, r: RunLike, agentsById: Map<string, Agent>, tz: string, synthetic = false) {
  const s = ops(slug);
  const name = runName(r);
  const solo = r.pipeline_name.startsWith(SOLO);
  const firstAgent = r.steps[0]?.agent_id ?? null;
  const link = synthetic ? (solo && firstAgent ? `/agents/${firstAgent}` : r.pipeline_id ? `/pipelines/${r.pipeline_id}` : "/runs") : `/runs/${r.id}`;
  const runId = synthetic ? null : r.id;
  const actor = solo ? name : r.trigger === "schedule" ? "Schedule" : r.trigger === "webhook" ? "Webhook" : name;
  const base = { run_id: runId, link, actor, agent_id: solo ? firstAgent : null };

  if (r.status === "awaiting_approval") {
    const at = r.steps.map((x) => x.finished_at ?? "").sort().pop() || r.created_at;
    pushAct(slug, { ...base, at, category: "run", type: "run.awaiting_approval", level: "warn", title: `${name} is waiting for your approval`, detail: `${plural(r.content_created || 1, "draft")} ready to review before publishing`, metrics: { content: r.content_created } }, `run:${r.id}:approval`);
    return;
  }
  if (!["succeeded", "failed", "cancelled"].includes(r.status) || !r.finished_at) return;
  const key = `run:${r.id}:end`;
  if (s.actKeys.has(key)) return;

  // step-level highlights (filters and dataset saves)
  r.steps.forEach((st, i) => {
    if (st.status !== "succeeded" || !st.finished_at) return;
    const stepBase = { run_id: runId, link, actor: st.agent_name, agent_id: st.agent_id || null, at: st.finished_at };
    if (["data_transform", "quality_gate", "change_detector", "comparer"].includes(st.kind) && st.items_in > st.items_out) {
      const removed = st.items_in - st.items_out;
      pushAct(
        slug,
        { ...stepBase, category: "run", type: "step.filtered", title: st.items_out ? `${st.agent_name} kept ${st.items_out} of ${st.items_in} items` : `${st.agent_name} dropped all ${st.items_in} items`, detail: st.items_out ? `${plural(removed, "item")} removed (duplicates, closed or below the bar)` : "Nothing new passed the checks this time", metrics: { kept: st.items_out, removed } },
        `run:${r.id}:step:${i}`,
      );
    }
    if (st.kind === "dataset_builder" && st.items_out > 0) {
      const ds = agentsById.get(st.agent_id)?.config.dataset;
      pushAct(
        slug,
        { ...stepBase, category: "data", type: "records.saved", level: "success", title: `${st.agent_name} saved ${plural(st.items_out, "record")}`, detail: "New and changed records were upserted into the dataset", link: typeof ds === "string" && ds ? `/datasets/${ds}` : link, xp: XP.records_saved.points, metrics: { records: st.items_out } },
        `run:${r.id}:records:${i}`,
      );
    }
  });

  if (r.status === "succeeded") {
    const processed = Math.max(0, ...r.steps.map((x) => Math.max(x.items_in, x.items_out)));
    const minutes = Math.round(r.steps.reduce((m, x) => m + x.items_out * (MINUTES_PER_ITEM[x.kind] ?? 1), 0));
    const day = dayIn(r.finished_at, tz);
    const firstToday = !s.okDays.has(day);
    const hadApproval = s.actKeys.has(`run:${r.id}:approval`);
    const chain = r.steps.filter((x) => x.kind !== "approval").map((x) => `${x.agent_name} ${x.items_out}`).join(" → ");
    pushAct(
      slug,
      {
        ...base,
        at: r.finished_at,
        category: "run",
        type: "run.finished",
        level: "success",
        title: r.items_out
          ? `${name} finished · ${plural(r.items_out, "item")}${r.content_created && !hadApproval ? ` · ${plural(r.content_created, "draft")}` : ""}`
          : r.content_created
            ? `${name} finished · ${plural(r.content_created, "approved draft")} held for the next slot`
            : `${name} finished · checked ${plural(processed, "item")}, nothing new this time`,
        detail: chain || null,
        xp: runXp(processed, firstToday),
        metrics: { items: r.items_out, processed, content: hadApproval ? 0 : r.content_created, minutes_saved: minutes, ...(firstToday ? { first_today: 1 } : {}) },
      },
      key,
    );
  } else if (r.status === "failed") {
    pushAct(slug, { ...base, at: r.finished_at, category: "run", type: "run.failed", level: "error", title: `${name} failed`, detail: r.error ?? "A step failed", metrics: { items: r.items_out } }, key);
  } else {
    pushAct(slug, { ...base, at: r.finished_at, category: "run", type: "run.cancelled", level: "warn", title: `${name} was cancelled`, metrics: {} }, key);
  }
}

function logPublished(slug: string, c: ContentItem) {
  if (c.status === "published" && c.published_at) {
    const ok = c.publications.filter((p) => p.status === "published");
    const manual = c.publications.filter((p) => p.status === "manual");
    const failed = c.publications.filter((p) => p.status === "failed");
    const parts = [ok.length ? `to ${ok.map((p) => p.connection_name).join(", ")}` : null, manual.length ? `${manual.map((p) => p.connection_name).join(", ")} ready to post by hand` : null, failed.length ? `${failed.length} channel${failed.length === 1 ? "" : "s"} failed` : null].filter(Boolean);
    pushAct(
      slug,
      { at: c.published_at, category: "publish", type: "content.published", level: failed.length ? "warn" : "success", title: `Published “${clip(c.title, 70)}”`, detail: parts.join(" · ") || null, actor: c.pipeline_name ?? userName(slug), link: `/content/${c.id}`, run_id: c.run_id, xp: XP.content_published.points, metrics: { channels: ok.length, manual: manual.length, failed: failed.length } },
      `pub:${c.id}`,
    );
  } else if (c.status === "failed") {
    pushAct(slug, { at: c.updated_at, category: "publish", type: "content.publish_failed", level: "error", title: `Couldn't publish “${clip(c.title, 70)}”`, detail: c.publications.find((p) => p.error)?.error ?? "Every channel failed", link: `/content/${c.id}`, run_id: c.run_id, metrics: {} }, `pubfail:${c.id}:${c.updated_at}`);
  }
}

const STREAK_TARGET: Record<string, number> = { marketpulse: 5, collegecompass: 3, hackfinder: 2, ten: 1 };
const HISTORY_DAYS = 13;

/** Items a seeded run would produce at each step for a plausible history (same shape as createRun). */
function synthCounts(kinds: string[], rng: () => number): number[] {
  const outs: number[] = [];
  const hasBuilder = kinds.includes("dataset_builder");
  kinds.forEach((k, i) => {
    const prev = i ? outs[i - 1] : 0;
    let o = prev;
    if (k === "news_monitor") o = 24 + Math.floor(rng() * 22);
    else if (k === "web_scraper") o = prev || 34 + Math.floor(rng() * 12);
    else if (k === "dataset_builder") o = prev || 4 + Math.floor(rng() * 4);
    else if (k === "data_transform") o = Math.max(1, Math.round(prev * (0.38 + rng() * 0.1)));
    else if (k === "persona_rewriter" || k === "custom_llm") o = hasBuilder ? prev : Math.min(prev || 1, 3 + Math.floor(rng() * 4));
    else if (k === "quality_gate") o = Math.max(0, Math.min(prev, rng() < 0.75 ? 1 : 0));
    else if (k === "auto_publisher") o = Math.min(prev, 1);
    outs.push(o);
  });
  return outs;
}

/** Seeds ~2 weeks of believable history for the sample workspaces (once). New workspaces start empty. */
function seedActivity(req: DemoRequest, runs: PipelineRun[], tz: string) {
  const slug = req.workspace;
  const s = ops(slug);
  const rng = seeded(`activity-${slug}`);
  const pipes = P<{ items: Pipeline[] }>(req, "GET", "/pipelines").items.filter((p) => !p.name.startsWith(SOLO) && p.steps.length);
  const agentsById = new Map(P<{ items: Agent[] }>(req, "GET", "/agents").items.map((a) => [a.id, a]));
  const content = P<Paged<ContentItem>>(req, "GET", "/content", undefined, { limit: "500" }).items;
  const conns = P<{ items: Connection[] }>(req, "GET", "/connections").items;
  for (const c of conns) if (c.status === "connected") s.awardedConns.add(c.id); // connected before the feed began
  const now = Date.now();
  const today = dayIn(now, tz);
  const realOk = new Set(runs.filter((r) => r.status === "succeeded" && r.finished_at).map((r) => dayIn(r.finished_at as string, tz)));
  const offsetOf = (k: number) => shiftDay(today, -k);
  const first = realOk.has(today) ? 0 : 1;
  let gap = first + (STREAK_TARGET[slug] ?? 2);
  while (realOk.has(offsetOf(gap))) gap++;
  const atOn = (k: number, hour: number) => {
    const t = now - k * 86_400_000;
    return new Date(t - msIntoDay(t, tz) + hour * 3_600_000).toISOString();
  };

  let hist = 0;
  const synthRun = (k: number, hour: number, p: Pipeline, fail: string | null) => {
    const kinds = p.steps.map((x) => x.kind ?? "custom_llm");
    const counts = synthCounts(kinds, rng);
    const end = new Date(atOn(k, hour)).getTime();
    const stepMs = 45_000;
    const failAt = fail ? Math.min(1, kinds.length - 1) : -1;
    const steps: RunStep[] = p.steps.map((x, i) => {
      const done = failAt < 0 || i <= failAt;
      const st = end - (kinds.length - i) * stepMs;
      return {
        step_id: x.id,
        agent_id: x.agent_id ?? "",
        agent_name: x.agent_name ?? "Agent",
        kind: kinds[i],
        status: !done ? "skipped" : i === failAt ? "failed" : "succeeded",
        started_at: done ? new Date(st).toISOString() : null,
        finished_at: done ? new Date(st + stepMs).toISOString() : null,
        duration_ms: done ? stepMs : null,
        items_in: i ? counts[i - 1] : 0,
        items_out: done && i !== failAt ? counts[i] : 0,
        logs: [],
        error: i === failAt ? fail : null,
      };
    });
    const last = [...steps].reverse().find((x) => x.status === "succeeded");
    const run: RunLike = {
      id: `hist_${slug}_${hist++}`,
      pipeline_id: p.id,
      pipeline_name: p.name,
      status: fail ? "failed" : "succeeded",
      trigger: p.trigger.type === "schedule" ? "schedule" : p.trigger.type === "webhook" ? "webhook" : "manual",
      finished_at: new Date(end).toISOString(),
      created_at: new Date(end - kinds.length * stepMs - 4000).toISOString(),
      items_out: last?.items_out ?? 0,
      content_created: 0,
      error: fail ? `${steps[failAt].agent_name}: ${fail}` : null,
      steps,
    };
    logRun(slug, run, agentsById, tz, true);
    // some history runs published a story (topic titles from the workspace's own content)
    const pub = !fail && kinds.includes("auto_publisher") && (last?.kind === "auto_publisher" && (last?.items_out ?? 0) > 0) && content.length;
    if (pub && rng() < 0.3) {
      const c = content[hist % content.length];
      const at = new Date(end + 60_000).toISOString();
      if (p.require_approval) pushAct(slug, { at: new Date(end - 30_000).toISOString(), category: "content", type: "content.approved", level: "success", title: `Approved “${clip(c.title, 70)}”`, actor: "Meera Pillai", link: "/content", xp: XP.content_approved.points, metrics: {} });
      pushAct(slug, { at, category: "publish", type: "content.published", level: "success", title: `Published “${clip(c.title, 70)}”`, detail: "to your website and social channels", actor: p.name, link: "/content", xp: XP.content_published.points, metrics: { channels: 3, manual: 0, failed: 0 } });
    }
  };

  if (pipes.length) {
    for (let k = HISTORY_DAYS; k >= 1; k--) {
      if (realOk.has(offsetOf(k))) continue;
      if (k === gap) {
        synthRun(k, 10, pipes[0], "Source timed out after 20s (retried 2×)");
        continue;
      }
      const n = 1 + (rng() < 0.25 ? 1 : 0);
      for (let j = 0; j < n; j++) synthRun(k, 9 + j * 5 + Math.floor(rng() * 3), pipes[(k + j) % pipes.length], null);
    }
  }

  // seeded people actions
  const members = s.members;
  if (members[4]) pushAct(slug, { at: atOn(12, 11), category: "team", type: "member.invited", level: "success", title: `${members[1]?.name ?? "A teammate"} invited ${members[4].name} as ${members[4].role}`, actor: members[1]?.name ?? null, link: "/settings/members", xp: XP.member_invited.points, metrics: {} });
  const qg = [...agentsById.values()].find((a) => a.kind === "quality_gate");
  if (qg) pushAct(slug, { at: atOn(6, 15), category: "agent", type: "agent.updated", title: `${members[2]?.name ?? "A teammate"} updated ${qg.name}`, detail: "Minimum score 70 → 75", actor: members[2]?.name ?? null, agent_id: qg.id, link: `/agents/${qg.id}`, metrics: {} });
  const conn = conns.find((c) => c.kind === "telegram") ?? conns[0];
  if (conn) pushAct(slug, { at: minutesAgo(1700), category: "connection", type: "connection.tested", level: "success", title: `${conn.name} test passed`, detail: "Channel id corrected after the bot was re-added", actor: members[0]?.name ?? null, link: "/connections", metrics: {} });
  // approvals of the seeded content that went through an approval step
  const approvalPipes = new Set(pipes.filter((p) => p.require_approval).map((p) => p.id));
  for (const c of content) {
    if ((c.status !== "approved" && c.status !== "published") || !c.pipeline_id || !approvalPipes.has(c.pipeline_id)) continue;
    const at = c.published_at ? new Date(new Date(c.published_at).getTime() - 3 * 60_000).toISOString() : c.updated_at;
    pushAct(slug, { at, category: "content", type: "content.approved", level: "success", title: `Approved “${clip(c.title, 70)}”`, actor: members[0]?.name ?? null, link: `/content/${c.id}`, run_id: c.run_id, xp: XP.content_approved.points, metrics: {} }, `approved:${c.id}`);
  }
}

/** Brings the feed up to date with runs and content (idempotent; keyed). */
function syncActivity(req: DemoRequest) {
  const slug = req.workspace;
  const s = ops(slug);
  const tz = tzOf(slug);
  const runs = runsFor(req);
  if (!s.actSeeded) {
    s.actSeeded = true;
    seedActivity(req, runs, tz);
  }
  const agentsById = new Map(P<{ items: Agent[] }>(req, "GET", "/agents").items.map((a) => [a.id, a]));
  const ordered = [...runs].sort((a, b) => (a.finished_at ?? a.created_at).localeCompare(b.finished_at ?? b.created_at));
  for (const r of ordered) logRun(slug, r, agentsById, tz);
  for (const c of P<Paged<ContentItem>>(req, "GET", "/content", undefined, { limit: "500" }).items) logPublished(slug, c);
}

function ensureActivity(req: DemoRequest) {
  if (!ops(req.workspace).actSeeded) syncActivity(req);
}

function sortedActivity(slug: string): ActivityItem[] {
  return [...ops(slug).activity].reverse().sort((a, b) => b.at.localeCompare(a.at));
}

function activityPage(req: DemoRequest): { items: ActivityItem[]; next_cursor: string | null } {
  syncActivity(req);
  let items = sortedActivity(req.workspace);
  const cats = (req.query.category ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (cats.length) items = items.filter((i) => cats.includes(i.category));
  if (req.query.agent_id) items = items.filter((i) => i.agent_id === req.query.agent_id);
  const before = req.query.before;
  if (before) {
    const idx = items.findIndex((i) => i.id === before);
    if (idx >= 0) items = items.slice(idx + 1);
    else if (!Number.isNaN(Date.parse(before))) items = items.filter((i) => i.at < new Date(before).toISOString());
  }
  const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 30) || 30));
  const page = items.slice(0, limit);
  return { items: page, next_cursor: items.length > limit ? page[page.length - 1].id : null };
}

function levelFor(xp: number) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.at) cur = l;
  const next = LEVELS.find((l) => l.at > xp);
  return { ...cur, next: next ? next.at : cur.at + 1000 };
}

function progress(req: DemoRequest): WorkspaceProgress {
  syncActivity(req);
  const slug = req.workspace;
  const s = ops(slug);
  const tz = tzOf(slug);
  const log = [...s.activity].sort((a, b) => a.at.localeCompare(b.at)); // oldest first
  const xp = log.reduce((n, i) => n + i.xp, 0);
  const lvl = levelFor(xp);
  const now = Date.now();
  const today = dayIn(now, tz);
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  const isToday = (i: ActivityItem) => dayIn(i.at, tz) === today;
  const inWeek = (i: ActivityItem) => i.at >= weekAgo;
  const of = (t: string) => log.filter((i) => i.type === t);
  const okRuns = of("run.finished");
  const failRuns = of("run.failed");
  const m = (i: ActivityItem, k: string) => i.metrics[k] ?? 0;
  const contentOf = (pred: (i: ActivityItem) => boolean) => log.filter((i) => (i.type === "run.finished" || i.type === "run.awaiting_approval") && pred(i)).reduce((n, i) => n + m(i, "content"), 0);

  // streaks (days with ≥1 successful run)
  const okDays = new Set(okRuns.map((i) => dayIn(i.at, tz)));
  let streak = 0;
  for (let d = okDays.has(today) ? today : shiftDay(today, -1); okDays.has(d); d = shiftDay(d, -1)) streak++;
  const sortedDays = [...okDays].sort();
  let best = 0;
  let runLen = 0;
  let streak7At: string | null = null;
  sortedDays.forEach((d, i) => {
    runLen = i > 0 && shiftDay(sortedDays[i - 1], 1) === d ? runLen + 1 : 1;
    best = Math.max(best, runLen);
    if (runLen === 7 && !streak7At) streak7At = okRuns.find((x) => dayIn(x.at, tz) === d)?.at ?? null;
  });
  best = Math.max(best, streak);

  // clean days (successes, no failures) for "a week without failures"
  const failDays = new Set(failRuns.map((i) => dayIn(i.at, tz)));
  let clean = 0;
  for (let d = okDays.has(today) ? today : shiftDay(today, -1); okDays.has(d) && !failDays.has(d); d = shiftDay(d, -1)) clean++;
  let cleanRun = 0;
  let cleanAt: string | null = null;
  sortedDays.forEach((d, i) => {
    cleanRun = failDays.has(d) ? 0 : i > 0 && shiftDay(sortedDays[i - 1], 1) === d && cleanRun > 0 ? cleanRun + 1 : 1;
    if (cleanRun === 7 && !cleanAt) cleanAt = `${d}T23:59:00.000Z`;
  });

  // cumulative items for "100 items"
  let cum = 0;
  let hundredAt: string | null = null;
  for (const i of okRuns) {
    cum += m(i, "processed");
    if (cum >= 100 && !hundredAt) hundredAt = i.at;
  }

  const agents = P<{ items: Agent[] }>(req, "GET", "/agents").items;
  const conns = P<{ items: Connection[] }>(req, "GET", "/connections").items;
  const datasets = P<{ items: Dataset[] }>(req, "GET", "/datasets").items;
  const content = P<Paged<ContentItem>>(req, "GET", "/content", undefined, { limit: "500" }).items;
  const connected = conns.filter((c) => c.status === "connected").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const agentDates = agents.map((a) => a.created_at).sort();
  let running = 0;
  const level5At = log.find((i) => (running += i.xp) >= LEVELS[4].at)?.at ?? null;
  const firstAt = (t: string) => log.find((i) => i.type === t)?.at ?? null;
  const approvals = of("content.approved").length;
  const publishes = of("content.published").length;

  const ach = (key: string, title: string, description: string, icon: string, current: number, target: number, at: string | null, ever = false): Achievement => {
    const unlocked = current >= target || ever;
    return { key, title, description, icon, unlocked, unlocked_at: unlocked ? at : null, progress: unlocked ? 1 : Math.min(1, +(current / target).toFixed(3)), target, current: unlocked ? Math.max(current, target) : current };
  };
  const achievements: Achievement[] = [
    ach("first_run", "First run", "Finish your first successful run", "Play", okRuns.length, 1, firstAt("run.finished")),
    ach("first_approval", "Editor's desk", "Approve your first draft", "CheckCheck", approvals, 1, firstAt("content.approved")),
    ach("first_publish", "Hello, world", "Publish your first piece of content", "Send", publishes, 1, firstAt("content.published")),
    ach("hundred_items", "Hundred items", "Process 100 items with your agents", "Layers", cum, 100, hundredAt),
    ach("streak_7", "Week-long streak", "Have a successful run 7 days in a row", "Flame", best, 7, streak7At),
    ach("zero_failures_week", "Smooth week", "7 days in a row with runs and no failures", "ShieldCheck", clean, 7, cleanAt, !!cleanAt),
    ach("five_agents", "Team of five", "Have 5 agents working for you", "Bot", agents.length, 5, agentDates[4] ?? null),
    ach("first_connection", "Plugged in", "Connect your website or a channel", "Plug", connected.length, 1, connected[0]?.created_at ?? null),
    ach("first_dataset", "Data keeper", "Create your first dataset", "Database", datasets.length, 1, [...datasets].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.created_at ?? null),
    ach("level_5", "Agent master", "Reach level 5", "Trophy", lvl.level, 5, level5At),
  ];

  const weekOk = okRuns.filter(inWeek).length;
  const weekFail = failRuns.filter(inWeek).length;
  return {
    level: lvl.level,
    level_name: lvl.name,
    xp,
    xp_level_start: lvl.at,
    xp_next_level: lvl.next,
    streak_days: streak,
    best_streak_days: best,
    today: {
      runs: okRuns.filter(isToday).length + failRuns.filter(isToday).length,
      items: okRuns.filter(isToday).reduce((n, i) => n + m(i, "processed"), 0),
      content: contentOf(isToday),
      published: of("content.published").filter(isToday).length,
      records: log.filter((i) => i.category === "data" && isToday(i)).reduce((n, i) => n + m(i, "records"), 0),
    },
    week: {
      runs: weekOk + weekFail,
      items: okRuns.filter(inWeek).reduce((n, i) => n + m(i, "processed"), 0),
      content: contentOf(inWeek),
      published: of("content.published").filter(inWeek).length,
      success_rate: weekOk + weekFail ? +(weekOk / (weekOk + weekFail)).toFixed(3) : null,
    },
    time_saved_minutes_week: okRuns.filter(inWeek).reduce((n, i) => n + m(i, "minutes_saved"), 0),
    achievements,
    next_steps: [
      { key: "connect_site", title: "Connect your website", description: "So agents can publish and send alerts for you.", href: "/connections", done: connected.length > 0 },
      { key: "activate_agent", title: "Activate an agent", description: "Pick a ready-made agent from the catalogue.", href: "/catalogue", done: agents.length > 0 },
      { key: "run_agent", title: "Run an agent", description: "Press Run on any agent and watch it work.", href: "/agents", done: okRuns.length > 0 },
      { key: "approve_post", title: "Approve your first post", description: "Check a draft and approve it for publishing.", href: "/content", done: approvals > 0 || content.some((c) => c.status === "approved" || c.status === "published") },
      { key: "invite_teammate", title: "Invite a teammate", description: "Share the work with your team.", href: "/settings/members", done: s.members.length > 1 },
    ],
    xp_rules: (Object.keys(XP) as XpRule[]).filter((k) => XP[k].points > 0).map((k) => ({ action: XP[k].action, points: XP[k].points })),
  };
}

function deliveries(req: DemoRequest, conn: Connection): WebhookDelivery[] {
  const s = ops(req.workspace);
  let list = s.deliveries.get(conn.id);
  if (!list) {
    const rng = seeded(`del-${conn.id}`);
    const url = String(conn.config.webhook_url ?? conn.config.site_url ?? conn.config.url ?? conn.config.base_url ?? `https://${conn.kind}.example.com`);
    list = Array.from({ length: 6 }, (_, i) => {
      const ok = !(i === 2 && conn.kind !== "x");
      return {
        id: uid("dlv_"),
        connection_id: conn.id,
        event: i === 4 ? "test" : "content.published",
        url,
        status_code: ok ? 200 : 502,
        ok,
        attempts: ok ? 1 : 3,
        duration_ms: Math.round(120 + rng() * 500),
        error: ok ? null : "Bad gateway from receiver (retried 3×)",
        at: hoursAgo(i * 7 + Math.round(rng() * 5) + 1),
      };
    });
    s.deliveries.set(conn.id, list);
  }
  return list;
}

function report(kind: AgentKind, a: Agent): string | null {
  if (kind === "site_auditor")
    return `## Site audit · ${String(a.config.site_url || "your site")}\n\nCrawled **25 pages** in 14 s.\n\n### Issues\n- **8 pages** missing a meta description\n- **3 duplicate title tags** (\`/news\`, \`/news?page=2\`, \`/archive\`)\n- **2 pages** without an H1\n- **1 broken link** → \`/old-ipo-calendar\` (404)\n\n### Next steps\n1. Add meta descriptions to the 8 listed pages (the SEO Optimizer can draft them).\n2. Canonicalise paginated archive pages.\n3. Fix or redirect the broken link.`;
  if (kind === "report_builder" || kind === "researcher")
    return `## ${kind === "researcher" ? "Evidence pack" : String(a.config.title ?? "Weekly report")}\n\n### Summary\nActivity was steady this week: 12 runs, 58 items processed and 9 pieces of content published.\n\n### Highlights\n- Approval turnaround dropped to **14 minutes** on average.\n- The quality gate dropped **4 duplicates** before publishing.\n\n### Risks\n- One connection failed twice (Telegram chat not found).\n\n### Sources\n1. Run history · LayerFlow\n2. Connection delivery logs`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Me                                                                   */
/* ------------------------------------------------------------------ */

export function meFor(slug: string): Me {
  const ws = demoWorkspace(slug) ?? demoWorkspace(DEMO_DEFAULT_WORKSPACE);
  const s = ops(ws?.slug ?? slug);
  const role: Role = s.members.find((m) => m.user_id === DEMO_OWNER_ID)?.role ?? "owner";
  return {
    user: { id: DEMO_OWNER_ID, email: ME_EMAIL, name: "Rohit Mehra", role: "owner", is_platform_admin: true },
    tenant: {
      id: ws?.id ?? "ws_demo",
      slug: ws?.slug ?? slug,
      name: ws?.name ?? "Demo",
      domain: ws?.domain ?? null,
      timezone: ws?.timezone ?? "Asia/Kolkata",
      site_url: ws?.domain ? `https://${ws.domain}` : null,
      modules: ws?.modules ?? ["pipelines"],
      industry: ws?.industry ?? "other",
      brand_color: ws?.brand_color ?? "#0f766e",
    },
    workspaces: demoWorkspaceLites(),
    csrf_token: "demo",
    provider: "ollama",
    role,
    permissions: PERMS[role],
    support_access: false,
    signup_enabled: true,
  };
}

export function demoOnboarding(slug: string): boolean {
  return ops(slug).onboarding;
}

/* ------------------------------------------------------------------ */
/* Router                                                               */
/* ------------------------------------------------------------------ */

export const handleOps: DemoHandler = (req) => {
  const [root, id, action, sub] = req.segments;
  const body = req.body ?? {};
  const s = ops(req.workspace);
  const M = req.method;

  switch (root) {
    case "auth":
      if (id === "register" && M === "POST") {
        if (!body.company || !body.email || !body.password) throw new DemoError(422, "validation_error", "Company, email and password are required");
        const ws = P<Workspace>(req, "POST", "/workspaces", { name: body.company, industry: body.industry || "other", domain: body.website || null, brand_color: "#0f766e" });
        const st = ops(ws.slug);
        st.onboarding = true;
        st.members[0] = { ...st.members[0], name: body.name || "You", email: body.email };
        try {
          window.localStorage.setItem("lf-workspace", ws.slug);
        } catch {
          /* ignore */
        }
        return meFor(ws.slug);
      }
      return UNHANDLED;

    case "catalog": {
      const agents = P<{ items: Agent[] }>(req, "GET", "/agents").items;
      if (!id && M === "GET") return { items: catalogFor(req, agents) };
      if (id && action === "activate" && M === "POST") {
        const entry = catalogFor(req, agents).find((c) => c.key === id);
        if (!entry) throw new DemoError(404, "not_found", "Catalogue agent not found");
        if (!entry.entitled) throw new DemoError(403, "upgrade_required", `${entry.name} needs the ${entry.pricing.tier === "pro" ? "Pro" : "Enterprise"} plan`);
        const limit = planOf(s.plan).limits.agents;
        if (limit !== -1 && agents.length >= limit) throw new DemoError(429, "quota_exceeded", `Your plan allows ${limit} agents`);
        const raw = CATALOG.find((c) => c.key === entry.key);
        const ws = demoWorkspace(req.workspace);
        const config = {
          ...activationConfig(entry.key, entry.kind, {
            industry: ws?.industry ?? "other",
            domain: ws?.domain ?? null,
            datasets: P<{ items: Dataset[] }>(req, "GET", "/datasets").items,
            connections: P<{ items: Connection[] }>(req, "GET", "/connections").items,
          }),
          // backend preset wins, except empty values (keep the demo's sample URLs/fields)
          ...Object.fromEntries(
            Object.entries(((raw?.preset as { config?: Record<string, unknown> } | undefined)?.config ?? {}) as Record<string, unknown>).filter(
              ([, v]) => !(v === "" || v === null || (Array.isArray(v) && v.length === 0)),
            ),
          ),
          ...(body.config && typeof body.config === "object" ? body.config : {}),
        };
        // drop preset values the demo schema doesn't know (backend option lists can be richer); defaults fill in
        for (const f of AGENT_TYPES.find((t) => t.kind === entry.kind)?.config_schema ?? []) {
          const allowed = f.type === "select" || f.type === "multiselect" ? (f.options ?? []).map((o) => o.value) : null;
          if (!allowed?.length || !(f.key in config)) continue;
          const v = config[f.key];
          if (f.type === "select" && !allowed.includes(String(v))) delete config[f.key];
          if (f.type === "multiselect") {
            const arr = (Array.isArray(v) ? v : [v]).map(String).filter((x) => allowed.includes(x));
            if (arr.length) config[f.key] = arr;
            else delete config[f.key];
          }
        }
        if (config.extraction === "ai") config.extraction = "auto";
        if (config.extraction === "selectors") config.extraction = "css";
        const presetModel = (raw?.preset as { model?: string } | undefined)?.model;
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : entry.name;
        const created = P<Agent>(req, "POST", "/agents", { name, kind: entry.kind, description: entry.everyday_use || entry.tagline, config, ...(presetModel ? { model: presetModel } : {}) });
        const m = meta(req, created);
        m.source = "platform";
        m.catalog_key = entry.key;
        audit(req.workspace, "agent.activated", "agent", created.id, { catalog_key: entry.key });
        act(req, { category: "agent", type: "agent.activated", level: "success", title: `Activated ${created.name}`, detail: entry.everyday_use || entry.tagline, agent_id: created.id, link: `/agents/${created.id}`, xp: XP.agent_activated.points, metrics: {} });
        return managed(req, created);
      }
      return UNHANDLED;
    }

    case "tools":
      return M === "GET" ? { items: TOOLS } : UNHANDLED;

    case "plans":
      return M === "GET" ? { items: PLANS } : UNHANDLED;

    case "agents": {
      if (id === "overview" && M === "GET") {
        const runs = runsFor(req);
        const agents = P<{ items: Agent[] }>(req, "GET", "/agents").items.map((a) => managed(req, a, runs));
        deriveEvents(req.workspace, runs);
        const weekAgo = Date.now() - 7 * 86_400_000;
        const steps = runs.filter((r) => new Date(r.created_at).getTime() > weekAgo).flatMap((r) => r.steps);
        const finished = steps.filter((x) => x.status === "succeeded" || x.status === "failed");
        const pipelines = P<{ items: Pipeline[] }>(req, "GET", "/pipelines").items.filter((p) => !p.name.startsWith(SOLO));
        const overview: AgentsOverview = {
          totals: {
            activated: agents.filter((a) => a.status !== "disabled").length,
            running: agents.filter((a) => a.live).length,
            idle: agents.filter((a) => !a.live && a.status === "active").length,
            paused: agents.filter((a) => a.status === "paused").length,
            scheduled: agents.filter((a) => a.schedule.every_minutes && a.status === "active").length + pipelines.filter((p) => p.trigger.type === "schedule").length,
            awaiting_approval: runs.filter((r) => r.status === "awaiting_approval").length,
            failed_24h: runs.filter((r) => r.status === "failed" && Date.now() - new Date(r.created_at).getTime() < 86_400_000).length,
            executions_7d: steps.length,
            items_processed_7d: steps.reduce((a, x) => a + x.items_out, 0),
            success_rate_7d: finished.length ? finished.filter((x) => x.status === "succeeded").length / finished.length : null,
          },
          upcoming: [
            ...pipelines.filter((p) => p.next_run_at).map((p) => ({ agent_id: null, pipeline_id: p.id, name: p.name, at: p.next_run_at as string })),
            ...agents.filter((a) => a.schedule.next_run_at).map((a) => ({ agent_id: a.id, pipeline_id: null, name: a.name, at: a.schedule.next_run_at as string })),
          ]
            .sort((a, b) => a.at.localeCompare(b.at))
            .slice(0, 6),
          recent: ops(req.workspace).events.slice(-12).reverse(),
        };
        return overview;
      }
      if (!id) {
        if (M === "GET") {
          const runs = runsFor(req);
          return { items: P<{ items: Agent[] }>(req, "GET", "/agents").items.map((a) => managed(req, a, runs)) };
        }
        if (M === "POST") {
          const created = P<Agent>(req, "POST", "/agents", body);
          const m = meta(req, created);
          m.source = "custom";
          audit(req.workspace, "agent.created", "agent", created.id, { kind: created.kind });
          act(req, { category: "agent", type: "agent.created", level: "success", title: `Built a new agent: ${created.name}`, detail: AGENT_TYPES.find((t) => t.kind === created.kind)?.name ?? created.kind, agent_id: created.id, link: `/agents/${created.id}`, xp: XP.agent_created.points, metrics: {} });
          return managed(req, created);
        }
        return UNHANDLED;
      }
      if (action === "test") return UNHANDLED;
      const agent = P<Agent>(req, "GET", `/agents/${id}`);
      const m = meta(req, agent);
      if (!action) {
        if (M === "GET") return managed(req, agent);
        if (M === "PATCH") {
          const { schedule, requires_approval, limits, ...rest } = body as Record<string, unknown>;
          const updated = Object.keys(rest).length ? P<Agent>(req, "PATCH", `/agents/${id}`, rest) : agent;
          if (schedule && typeof schedule === "object") m.every_minutes = ((schedule as { every_minutes?: number | null }).every_minutes ?? null) || null;
          if (requires_approval !== undefined) m.requires_approval = !!requires_approval;
          if (limits && typeof limits === "object") m.limits = { ...m.limits, ...(limits as object) };
          if (rest.config !== undefined || rest.model !== undefined) {
            m.versions.push({ version: m.versions.length + 1, config: JSON.parse(JSON.stringify(updated.config)), model: updated.model, note: typeof body.version_note === "string" && body.version_note ? body.version_note : null, created_by: ME_EMAIL, created_at: new Date().toISOString() });
          }
          audit(req.workspace, "agent.updated", "agent", id, { version: m.versions.length });
          act(req, { category: "agent", type: "agent.updated", title: `Updated ${updated.name}`, detail: rest.config !== undefined || rest.model !== undefined ? `Settings saved as version ${m.versions.length}` : schedule ? "Schedule changed" : null, agent_id: id, link: `/agents/${id}`, metrics: {} });
          return managed(req, updated);
        }
        if (M === "DELETE") {
          if (m.soloPipelineId) {
            try {
              P(req, "DELETE", `/pipelines/${m.soloPipelineId}`);
            } catch {
              /* ignore */
            }
            m.soloPipelineId = null;
          }
          P(req, "DELETE", `/agents/${id}`);
          s.agents.delete(id);
          audit(req.workspace, "agent.deleted", "agent", id);
          act(req, { category: "agent", type: "agent.deleted", level: "warn", title: `Deleted ${agent.name}`, agent_id: id, link: "/agents", metrics: {} });
          return undefined;
        }
        return UNHANDLED;
      }
      if (M === "POST" && (action === "pause" || action === "resume" || action === "disable")) {
        m.status = action === "pause" ? "paused" : action === "resume" ? "active" : "disabled";
        P(req, "PATCH", `/agents/${id}`, { enabled: m.status !== "disabled" });
        const verb = action === "resume" ? "resumed" : action === "pause" ? "paused" : "disabled";
        audit(req.workspace, `agent.${verb}`, "agent", id);
        act(req, { category: "agent", type: `agent.${verb}`, level: action === "resume" ? "info" : "warn", title: `${action === "resume" ? "Resumed" : action === "pause" ? "Paused" : "Turned off"} ${agent.name}`, agent_id: id, link: `/agents/${id}`, metrics: {} });
        return managed(req, P<Agent>(req, "GET", `/agents/${id}`));
      }
      if (M === "POST" && action === "run") {
        if (m.status !== "active") throw new DemoError(409, "agent_paused", `${agent.name} is ${m.status}. Resume it to run.`);
        const pipes = P<{ items: Pipeline[] }>(req, "GET", "/pipelines").items;
        if (!m.soloPipelineId || !pipes.some((p) => p.id === m.soloPipelineId)) {
          m.soloPipelineId = P<Pipeline>(req, "POST", "/pipelines", { name: `${SOLO}${agent.name}`, steps: [{ agent_id: id }], trigger: { type: "manual" }, require_approval: false }).id;
        }
        const run = P<PipelineRun>(req, "POST", `/pipelines/${m.soloPipelineId}/run`, { trigger: "manual" });
        audit(req.workspace, "agent.run", "agent", id, { run_id: run.id });
        act(req, { category: "run", type: "run.started", title: `Started ${agent.name}`, agent_id: id, run_id: run.id, link: `/runs/${run.id}`, metrics: {} });
        return run;
      }
      if (M === "GET" && action === "versions" && !sub) return { items: [...m.versions].reverse() };
      if (M === "POST" && action === "versions" && sub && req.segments[4] === "restore") {
        const v = m.versions.find((x) => x.version === Number(sub));
        if (!v) throw new DemoError(404, "not_found", "Version not found");
        const updated = P<Agent>(req, "PATCH", `/agents/${id}`, { config: v.config, model: v.model });
        m.versions.push({ version: m.versions.length + 1, config: JSON.parse(JSON.stringify(v.config)), model: v.model, note: `Restored v${v.version}`, created_by: ME_EMAIL, created_at: new Date().toISOString() });
        audit(req.workspace, "agent.version_restored", "agent", id, { version: v.version });
        return managed(req, updated);
      }
      if (M === "GET" && action === "executions") {
        const runs = runsFor(req);
        const items: AgentExecution[] = [];
        for (const r of runs)
          for (const st of r.steps)
            if (st.agent_id === id)
              items.push({
                run_id: r.id,
                step_id: st.step_id,
                pipeline_id: r.pipeline_name.startsWith(SOLO) ? null : r.pipeline_id,
                pipeline_name: r.pipeline_name.startsWith(SOLO) ? null : r.pipeline_name,
                trigger: r.trigger,
                status: r.status === "awaiting_approval" && st.status === "pending" ? "awaiting_approval" : st.status === "pending" ? "queued" : st.status,
                started_at: st.started_at,
                finished_at: st.finished_at,
                duration_ms: st.duration_ms,
                items_in: st.items_in,
                items_out: st.items_out,
                tools_used: TOOLS_BY_KIND[st.kind as AgentKind]?.slice(0, 3) ?? [],
                attempts: st.status === "failed" ? 3 : 1,
                model_calls: AGENT_TYPES.find((t) => t.kind === st.kind)?.uses_model ? Math.max(1, st.items_out) : 0,
                error: st.error,
              });
        return { items: items.slice(0, Number(req.query.limit ?? 50) || 50) };
      }
      if (M === "GET" && action === "outputs") {
        const test = P<AgentTestResult>(req, "POST", `/agents/${id}/test`, { input: {} });
        const content = P<Paged<ContentItem>>(req, "GET", "/content", undefined, { limit: "100" }).items;
        const pipes = P<{ items: Pipeline[] }>(req, "GET", "/pipelines").items.filter((p) => p.steps.some((x) => x.agent_id === id)).map((p) => p.id);
        const ds = typeof agent.config.dataset === "string" ? agent.config.dataset : null;
        const out: AgentOutputs = {
          items: test.items.slice(0, 20),
          content_ids: content.filter((c) => c.pipeline_id && pipes.includes(c.pipeline_id)).map((c) => c.id).slice(0, 10),
          dataset_changes: ds && (agent.kind === "dataset_builder" || agent.kind === "change_detector") ? { dataset_id: ds, created: 2, updated: 5 } : null,
          report: report(agent.kind, agent),
        };
        return out;
      }
      if (M === "GET" && action === "events") return eventsFor(req, (e) => e.agent_id === id);
      return UNHANDLED;
    }

    case "runs": {
      if (id && action === "events" && M === "GET") return eventsFor(req, (e) => e.run_id === id);
      if (id && (action === "approve" || action === "reject") && M === "POST") {
        const run = P<PipelineRun>(req, "GET", `/runs/${id}`);
        const drafts = P<Paged<ContentItem>>(req, "GET", "/content", undefined, { limit: "200" }).items.filter((c) => c.run_id === id && c.status === "draft");
        for (const c of drafts) {
          const out = P<ContentItem>(req, "POST", `/content/${c.id}/${action}`, action === "reject" ? { reason: body.reason ?? "Rejected from the run view" } : {});
          logContentReview(req, out, action);
        }
        if (!drafts.length && run.status === "awaiting_approval" && action === "reject") P(req, "POST", `/runs/${id}/cancel`);
        audit(req.workspace, `run.${action === "approve" ? "approved" : "rejected"}`, "run", id);
        syncActivity(req);
        return P<PipelineRun>(req, "GET", `/runs/${id}`);
      }
      return UNHANDLED;
    }

    case "activity":
      return M === "GET" && !id ? activityPage(req) : UNHANDLED;

    case "progress":
      return M === "GET" && !id ? progress(req) : UNHANDLED;

    case "events":
      if (id === "stream") throw new DemoError(501, "demo_unavailable", "Streaming is not available in demo mode; poll /events instead");
      return UNHANDLED;

    case "pipelines": {
      if (id && action === "versions" && M === "GET") {
        const list = s.pipelineVersions.get(id);
        if (!list?.length) {
          const p = stepView(s, P<Pipeline>(req, "GET", `/pipelines/${id}`));
          return { items: [{ version: 1, steps: p.steps, trigger: p.trigger, created_by: ME_EMAIL, created_at: p.created_at }] };
        }
        return { items: [...list].reverse() };
      }
      if (id && action === "run" && M === "POST") {
        const run = P<PipelineRun>(req, "POST", `/pipelines/${id}/run`, body);
        act(req, { category: "run", type: "run.started", title: `Started ${runName(run)}`, run_id: run.id, link: `/runs/${run.id}`, metrics: {} });
        return run;
      }
      if ((M === "POST" && !id) || (M === "PATCH" && id && !action)) {
        if (!Array.isArray(body.steps)) return UNHANDLED;
        const { agentSteps, approvals } = splitSteps(req.workspace, id ?? null, body.steps as StepIn[]);
        if (!agentSteps.length) throw new DemoError(422, "validation_error", "Add at least one agent step");
        const requireApproval = approvals.length > 0 || !!body.require_approval;
        const p = M === "POST" ? P<Pipeline>(req, "POST", "/pipelines", { ...body, steps: agentSteps, require_approval: requireApproval }) : P<Pipeline>(req, "PATCH", `/pipelines/${id}`, { ...body, steps: agentSteps, require_approval: requireApproval });
        s.approvals.set(p.id, approvals);
        recordPipelineVersion(req.workspace, p);
        audit(req.workspace, M === "POST" ? "workflow.created" : "workflow.updated", "workflow", p.id);
        act(req, { category: "agent", type: M === "POST" ? "workflow.created" : "workflow.updated", title: `${M === "POST" ? "Created" : "Updated"} the workflow ${p.name}`, detail: `${plural(agentSteps.length, "step")}${approvals.length ? ` + ${plural(approvals.length, "approval")}` : ""}`, link: `/pipelines/${p.id}`, metrics: {} });
        return stepView(s, p);
      }
      return UNHANDLED;
    }

    case "content": {
      if (!id || M === "GET") return UNHANDLED;
      if (M === "POST" && (action === "approve" || action === "reject")) {
        const out = P<ContentItem>(req, M, req.path, body, req.query);
        logContentReview(req, out, action);
        syncActivity(req);
        return out;
      }
      if (M === "POST" && action === "publish") {
        const out = P<ContentItem>(req, M, req.path, body, req.query);
        syncActivity(req); // the publish item (and its XP) comes from the content state
        return out;
      }
      if (M === "PATCH" && !action) {
        const before = P<ContentItem>(req, "GET", `/content/${id}`);
        const out = P<ContentItem>(req, M, req.path, body, req.query);
        const coverOnly = Object.keys(body).length === 1 && body.image_url !== undefined;
        act(req, { category: "content", type: coverOnly ? "content.cover_changed" : "content.edited", title: coverOnly ? `Changed the cover image of “${clip(out.title, 70)}”` : `Edited “${clip(out.title, 70)}”`, detail: !coverOnly && before.title !== out.title ? `Title was “${clip(before.title, 60)}”` : null, run_id: out.run_id, link: `/content/${out.id}`, metrics: {} });
        return out;
      }
      if (M === "DELETE" && !action) {
        const before = P<ContentItem>(req, "GET", `/content/${id}`);
        P(req, M, req.path, body, req.query);
        act(req, { category: "content", type: "content.deleted", level: "warn", title: `Deleted “${clip(before.title, 70)}”`, link: "/content", metrics: {} });
        return undefined;
      }
      return UNHANDLED;
    }

    case "datasets": {
      if (M === "GET") return UNHANDLED;
      if (!id && M === "POST") {
        const d = P<Dataset>(req, M, req.path, body, req.query);
        act(req, { category: "data", type: "dataset.created", level: "success", title: `Created the dataset ${d.name}`, detail: plural(d.fields.length, "field"), link: `/datasets/${d.id}`, xp: XP.dataset_created.points, metrics: {} });
        return d;
      }
      if (!id) return UNHANDLED;
      const ds = P<Dataset>(req, "GET", `/datasets/${id}`);
      if (action === "records") {
        const recId = sub;
        if (!recId && M === "POST") {
          const before = ds.record_count;
          const rec = P<DatasetRecord>(req, M, req.path, body, req.query);
          const created = P<Dataset>(req, "GET", `/datasets/${id}`).record_count > before;
          act(req, { category: "data", type: created ? "records.added" : "records.edited", level: "success", title: `${created ? "Added" : "Updated"} ${rec.key} in ${ds.name}`, link: `/datasets/${ds.id}`, xp: XP.records_saved.points, metrics: { records: 1 } });
          return rec;
        }
        if (recId && M === "PATCH") {
          const rec = P<DatasetRecord>(req, M, req.path, body, req.query);
          act(req, { category: "data", type: "records.edited", level: "success", title: `Edited ${rec.key} in ${ds.name}`, link: `/datasets/${ds.id}`, xp: XP.records_saved.points, metrics: { records: 1 } });
          return rec;
        }
        if (recId && M === "DELETE") {
          const rec = P<DatasetRecord>(req, "GET", `/datasets/${id}/records/${recId}`);
          P(req, M, req.path, body, req.query);
          act(req, { category: "data", type: "records.deleted", level: "warn", title: `Deleted ${rec.key} from ${ds.name}`, link: `/datasets/${ds.id}`, metrics: { records: 1 } });
          return undefined;
        }
        return UNHANDLED;
      }
      if (action === "import" && M === "POST") {
        const res = P<{ created: number; updated: number; skipped: number }>(req, M, req.path, body, req.query);
        const saved = res.created + res.updated;
        act(req, { category: "data", type: "records.imported", level: res.skipped ? "warn" : "success", title: `Imported ${plural(saved, "record")} into ${ds.name}`, detail: `${res.created} new, ${res.updated} updated${res.skipped ? `, ${res.skipped} skipped` : ""}`, link: `/datasets/${ds.id}`, xp: saved ? XP.records_saved.points : 0, metrics: { records: saved, created: res.created, updated: res.updated, skipped: res.skipped } });
        return res;
      }
      if (!action && M === "PATCH") {
        const out = P<Dataset>(req, M, req.path, body, req.query);
        act(req, { category: "data", type: "dataset.updated", title: `Updated the dataset ${out.name}`, link: `/datasets/${out.id}`, metrics: {} });
        return out;
      }
      if (!action && M === "DELETE") {
        P(req, M, req.path, body, req.query);
        act(req, { category: "data", type: "dataset.deleted", level: "warn", title: `Deleted the dataset ${ds.name}`, link: "/datasets", metrics: {} });
        return undefined;
      }
      return UNHANDLED;
    }

    case "api-keys": {
      if (!id && M === "POST") {
        const out = P<{ key: ApiKey; secret: string }>(req, M, req.path, body, req.query);
        act(req, { category: "system", type: "api_key.created", title: `Created the API key ${out.key.name}`, detail: out.key.scopes.join(", "), link: "/developers", metrics: {} });
        return out;
      }
      if (id && M === "DELETE") {
        const key = P<{ items: ApiKey[] }>(req, "GET", "/api-keys").items.find((k) => k.id === id);
        P(req, M, req.path, body, req.query);
        act(req, { category: "system", type: "api_key.revoked", level: "warn", title: `Revoked the API key ${key?.name ?? id}`, link: "/developers", metrics: {} });
        return undefined;
      }
      return UNHANDLED;
    }

    case "members": {
      if (!id && M === "GET") return { items: s.members };
      if (!id && M === "POST") {
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new DemoError(422, "validation_error", "Enter a valid email address");
        if (s.members.some((m) => m.email === email)) throw new DemoError(409, "already_member", `${email} is already a member`);
        const member: Member = { id: uid("mem_"), user_id: uid("usr_"), email, name: body.name || null, role: (body.role as Role) || "viewer", status: "invited", last_login_at: null, created_at: new Date().toISOString() };
        s.members.push(member);
        audit(req.workspace, "member.invited", "member", member.id, { email, role: member.role });
        act(req, { category: "team", type: "member.invited", level: "success", title: `Invited ${member.name || email} as ${member.role}`, link: "/settings/members", xp: XP.member_invited.points, metrics: {} });
        const res: InviteResult = { member, temp_password: `lf-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}` };
        return res;
      }
      const m = s.members.find((x) => x.id === id);
      if (!m) throw new DemoError(404, "not_found", "Member not found");
      const owners = s.members.filter((x) => x.role === "owner");
      if (M === "PATCH") {
        if (m.role === "owner" && body.role !== "owner" && owners.length === 1) throw new DemoError(409, "last_owner", "The last owner can't be demoted");
        m.role = body.role ?? m.role;
        audit(req.workspace, "member.role_changed", "member", m.id, { role: m.role });
        act(req, { category: "team", type: "member.role_changed", title: `${m.name || m.email} is now ${m.role}`, link: "/settings/members", metrics: {} });
        return m;
      }
      if (M === "DELETE") {
        if (m.role === "owner" && owners.length === 1) throw new DemoError(409, "last_owner", "The last owner can't be removed");
        s.members = s.members.filter((x) => x.id !== id);
        audit(req.workspace, "member.removed", "member", id, { email: m.email });
        act(req, { category: "team", type: "member.removed", level: "warn", title: `Removed ${m.name || m.email} from the team`, link: "/settings/members", metrics: {} });
        return undefined;
      }
      return UNHANDLED;
    }

    case "usage":
      return M === "GET" ? usage(req) : UNHANDLED;

    case "audit": {
      if (M !== "GET") return UNHANDLED;
      let items = s.audit;
      if (req.query.action) items = items.filter((e) => e.action.includes(req.query.action));
      return { items: items.slice(0, Number(req.query.limit ?? 100) || 100) };
    }

    case "notifications": {
      if (!id && M === "GET") return notifications(req);
      if (id === "read-all" && M === "POST") {
        s.allRead = Date.now();
        return notifications(req);
      }
      return UNHANDLED;
    }

    case "connections": {
      if (id && action === "deliveries" && M === "GET") {
        const conn = P<{ items: Connection[] }>(req, "GET", "/connections").items.find((c) => c.id === id);
        if (!conn) throw new DemoError(404, "not_found", "Connection not found");
        return { items: deliveries(req, conn) };
      }
      if (!id && M === "POST") {
        const c = P<Connection>(req, M, req.path, body, req.query);
        const ok = c.status === "connected";
        const first = ok && !s.awardedConns.has(c.id);
        if (first) s.awardedConns.add(c.id);
        act(req, { category: "connection", type: ok ? "connection.connected" : "connection.created", level: ok ? "success" : "warn", title: ok ? `Connected ${c.name}` : `Added ${c.name}: needs setup`, detail: ok ? null : "Fill in the missing fields and press Test", link: "/connections", xp: first ? XP.connection_ok.points : 0, metrics: {} });
        return c;
      }
      if (id && action === "test" && M === "POST") return testConnection(req, id, !!body.send);
      if (id && !action && M === "PATCH") {
        const c = P<Connection>(req, M, req.path, body, req.query);
        act(req, { category: "connection", type: "connection.updated", title: `Updated ${c.name}`, detail: c.status === "connected" ? null : "Still needs setup", link: "/connections", metrics: {} });
        return c;
      }
      if (id && !action && M === "DELETE") {
        const c = P<{ items: Connection[] }>(req, "GET", "/connections").items.find((x) => x.id === id);
        P(req, M, req.path, body, req.query);
        act(req, { category: "connection", type: "connection.removed", level: "warn", title: `Removed ${c?.name ?? "a connection"}`, link: "/connections", metrics: {} });
        return undefined;
      }
      return UNHANDLED;
    }

    case "platform": {
      if (id === "health" && M === "GET") {
        const health: PlatformHealth = {
          provider: "ollama",
          model: { status: "ok", detail: "qwen2.5:7b-instruct + qwen2.5:3b-instruct loaded (CPU)", models: ["qwen2.5:7b-instruct", "qwen2.5:3b-instruct", "nomic-embed-text"] },
          queue: { queued: 1, running: 2, failed_24h: 2, dead: 0, oldest_queued_age_s: 4 },
          workers: [
            { id: "worker-1 · mac-studio", last_seen: minutesAgo(0.2), running: 1 },
            { id: "worker-2 · mac-studio", last_seen: minutesAgo(0.4), running: 1 },
          ],
          errors_24h: [
            { at: hoursAgo(3), workspace: "marketpulse", message: "Telegram: chat not found (400)" },
            { at: hoursAgo(9), workspace: "collegecompass", message: "nirfindia.org timed out after 20s (retried 2×)" },
          ],
        };
        return health;
      }
      return UNHANDLED;
    }

    case "workspaces": {
      if (id && M === "PATCH" && !action) {
        const target: DemoRequest = { ...req, workspace: id };
        const so = ops(id);
        const opsFields = body.plan !== undefined || body.status !== undefined || body.website !== undefined || body.models !== undefined;
        const { plan: _p, status: _s, website: _w, models: _m, ...rest } = body as Record<string, unknown>;
        void _p;
        void _s;
        void _w;
        void _m;
        if (body.website !== undefined) so.website = body.website ? String(body.website) : null;
        if (body.plan) so.plan = body.plan as PlanKey;
        if (body.status) so.status = body.status;
        if (opsFields) audit(id, "workspace.plan_changed", "workspace", id, { plan: so.plan, status: so.status });
        if (Object.keys(rest).length) P(req, "PATCH", `/workspaces/${id}`, rest);
        const changed = Object.keys(body);
        if (demoWorkspace(id)) act(target, { category: "system", type: "workspace.updated", title: body.plan ? `Plan changed to ${planOf(so.plan).name}` : "Updated workspace settings", detail: changed.length ? `Changed: ${changed.join(", ")}` : null, link: "/settings/workspace", metrics: {} });
        return P<Workspace>(req, "GET", `/workspaces/${id}`);
      }
      return UNHANDLED;
    }

    default:
      return UNHANDLED;
  }
};

/** Logs a content approval / rejection (approval earns XP). */
function logContentReview(req: DemoRequest, c: ContentItem, action: "approve" | "reject") {
  if (action === "approve")
    act(req, { category: "content", type: "content.approved", level: "success", title: `Approved “${clip(c.title, 70)}”`, run_id: c.run_id, link: `/content/${c.id}`, xp: XP.content_approved.points, metrics: {} }, `approved:${c.id}`);
  else act(req, { category: "content", type: "content.rejected", level: "warn", title: `Rejected “${clip(c.title, 70)}”`, detail: c.quality?.flags.find((f) => f.startsWith("Rejected:"))?.slice(10) ?? null, run_id: c.run_id, link: `/content/${c.id}`, metrics: {} });
}

/** What a "send a test" does per connection kind (friendly, plain words). */
function testSendDetail(c: Connection): string {
  const cfg = c.config;
  switch (c.kind) {
    case "telegram":
      return `Sent a test post to your Telegram channel ${String(cfg.chat_id ?? "")}`.trim();
    case "nextjs":
      return `Sent a test post to your website (${String(cfg.site_url ?? cfg.webhook_url ?? "your site")}) — it answered 200 OK`;
    case "wordpress":
      return `Created a private test draft on ${String(cfg.site_url ?? "your WordPress site")} — you can delete it any time`;
    case "ghost":
      return `Created a test draft on ${String(cfg.api_url ?? "your Ghost blog")}`;
    case "webhook":
      return `Sent a test event to ${String(cfg.url ?? "your webhook")} — 204 No Content`;
    case "linkedin":
      return "Shared a test post on LinkedIn — delete it from your feed once you've seen it";
    case "x":
      return "X doesn't allow free automatic posting, so a test thread was prepared in Content for you to copy";
    case "slack":
      return "Sent a test message to your Slack channel";
    case "discord":
      return "Sent a test message to your Discord channel";
    case "email_smtp": {
      const to = Array.isArray(cfg.to) && cfg.to.length ? (cfg.to as string[]).join(", ") : String(cfg.from ?? "your inbox");
      return `Sent a test email to ${to}`;
    }
    case "rest_api":
      return `Sent a test request to ${String(cfg.base_url ?? "your API")} — 200 OK`;
    default:
      return `Sent a test message through ${c.name}`;
  }
}

/** POST /connections/{id}/test — `send: true` also sends a real-looking test message/post and records a delivery. */
function testConnection(req: DemoRequest, id: string, send: boolean): ConnectionTestResult {
  const s = ops(req.workspace);
  const res = P<ConnectionTestResult>(req, "POST", `/connections/${id}/test`, {});
  const conn = P<{ items: Connection[] }>(req, "GET", "/connections").items.find((c) => c.id === id);
  if (!conn) throw new DemoError(404, "not_found", "Connection not found");
  let out = res;
  if (send && res.ok) {
    out = { ...res, detail: testSendDetail(conn) };
    const list = deliveries(req, conn);
    const url = String(conn.config.webhook_url ?? conn.config.site_url ?? conn.config.url ?? conn.config.base_url ?? conn.config.api_url ?? `https://${conn.kind}.example.com`);
    list.unshift({ id: uid("dlv_"), connection_id: conn.id, event: "test", url, status_code: conn.kind === "webhook" ? 204 : 200, ok: true, attempts: 1, duration_ms: res.latency_ms, error: null, at: new Date().toISOString() });
  }
  const first = res.ok && !s.awardedConns.has(conn.id);
  if (first) s.awardedConns.add(conn.id);
  act(req, {
    category: "connection",
    type: send ? "connection.test_sent" : "connection.tested",
    level: res.ok ? "success" : "error",
    title: res.ok ? (send ? `Sent a test message to ${conn.name}` : `${conn.name} test passed`) : `${conn.name} test failed`,
    detail: out.detail,
    link: "/connections",
    xp: first ? XP.connection_ok.points : 0,
    metrics: res.latency_ms !== null ? { latency_ms: res.latency_ms } : {},
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Post-processing of platform responses (decorations)                  */
/* ------------------------------------------------------------------ */

function decorateWorkspace(w: Workspace): Workspace {
  const so = ops(w.slug);
  return { ...w, status: so.status, plan: so.plan, website: so.website } as Workspace;
}

export function opsPostProcess(req: DemoRequest, out: unknown): unknown {
  if (!out || typeof out !== "object") return out;
  const [root, id, action] = req.segments;
  const s = ops(req.workspace);
  const o = out as Record<string, unknown>;
  if (root === "pipelines" && req.method === "GET") {
    if (!id) return { ...o, items: (o.items as Pipeline[]).filter((p) => !p.name.startsWith(SOLO)).map((p) => stepView(s, p)) };
    if (!action) return stepView(s, out as Pipeline);
  }
  if (root === "runs" && req.method !== "DELETE" && action !== "events") {
    const pipes = P<{ items: Pipeline[] }>(req, "GET", "/pipelines").items;
    if (Array.isArray(o.items)) {
      let items = o.items as PipelineRun[];
      if (req.query.agent_id) items = items.filter((r) => r.steps.some((x) => x.agent_id === req.query.agent_id));
      return { ...o, items: items.map((r) => decorateRun(s, r, pipes)) };
    }
    if ("steps" in o && "pipeline_id" in o) return decorateRun(s, out as PipelineRun, pipes);
  }
  if (root === "pipelines" && action === "run") return decorateRun(s, out as PipelineRun, P<{ items: Pipeline[] }>(req, "GET", "/pipelines").items);
  if (root === "dashboard" && id === "workspace") {
    const pipes = P<{ items: Pipeline[] }>(req, "GET", "/pipelines").items;
    const d = out as { workspace: Workspace; recent_runs: PipelineRun[] };
    return { ...d, workspace: decorateWorkspace(d.workspace), recent_runs: d.recent_runs.map((r) => decorateRun(s, r, pipes)) };
  }
  if (root === "workspaces" && req.method !== "DELETE") {
    if (Array.isArray(o.items)) return { ...o, items: (o.items as Workspace[]).map(decorateWorkspace) };
    if ("slug" in o) return decorateWorkspace(out as Workspace);
  }
  if (root === "platform" && id === "overview") {
    const ov = out as { workspaces: Workspace[] };
    return { ...ov, workspaces: ov.workspaces.map(decorateWorkspace) };
  }
  return out;
}
