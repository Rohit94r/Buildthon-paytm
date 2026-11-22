// In-memory mock of the LayerFlow platform API (docs/platform/API.md, section 2) for demo mode.
// State is module-level, keyed by workspace slug, lazily seeded, and lives for the browser tab.
// Pipeline runs progress on wall-clock time: every request recomputes them from elapsed time and
// applies side effects (content drafts, dataset upserts, publications) once their step has finished.

import type {
  ActivityEvent,
  Agent,
  AgentKind,
  AgentStats,
  AgentTestRequest,
  AgentTestResult,
  ApiKey,
  ApiKeyCreated,
  ApiScope,
  ChatRequest,
  ChatResponse,
  Connection,
  ConnectionKind,
  ConnectionTestResult,
  ContentFormat,
  ContentItem,
  ContentPublication,
  ContentStatus,
  ContentVariant,
  Dataset,
  DatasetField,
  DatasetRecord,
  FlowItem,
  ModelInfo,
  Module,
  Paged,
  Pipeline,
  PipelineRun,
  PipelineRunSummary,
  PipelineStep,
  PlatformOverview,
  RunLog,
  RunStatus,
  RunStep,
  StepStatus,
  Workspace,
  WorkspaceDashboard,
  WorkspaceLite,
  WorkspaceStats,
} from "@/lib/platform-types";
import { DemoError, UNHANDLED, clone, daysAgo, minutesAgo, notFound, paginate, seeded, slugify, uid, type DemoHandler, type DemoRequest } from "./core";
import { AGENT_TYPES, ALL_FORMATS, BLUEPRINTS, BLUEPRINT_SPECS, CONNECTION_KINDS, MODULES, agentType, configDefaults, connectionKind, parseBlueprintTrigger } from "./catalog";
import { DATASET_TEMPLATES, PLATFORM_SEEDS, WORKSPACE_SEEDS, type DatasetTemplate } from "./platform-fixtures";
import { TOPICS, TOPIC_POOLS, buildSeo, buildVariant, slugFor, type BrandContext, type TopicSpec } from "./platform-content";
import { runChat } from "./chat";
import { demoImages, themeFor, uploadedImage } from "./images";

export const DEMO_DEFAULT_WORKSPACE = "marketpulse";

const CHAT_MODEL = "qwen2.5:3b-instruct"; // fast model: the assistant is real-time
const MODEL_TAGS: Record<string, string> = { writer: "qwen2.5:14b-instruct", fast: "qwen2.5:7b-instruct" };
const MODELS: ModelInfo[] = [
  { name: "qwen2.5:14b-instruct", role: "writer", size_gb: 9.0, loaded: true },
  { name: "qwen2.5:7b-instruct", role: "fast", size_gb: 4.7, loaded: true },
  { name: "nomic-embed-text", role: "embed", size_gb: 0.27, loaded: false },
];
const HOOK_BASE = "https://app.layerflow.dev/api/public/v1/hooks/pipelines";

/* ====================================================================================== */
/* Store                                                                                  */
/* ====================================================================================== */

interface WsBase {
  id: string;
  slug: string;
  name: string;
  industry: string;
  brand_color: string;
  domain: string | null;
  timezone: string;
  modules: Module[];
  blueprint: string | null;
  created_at: string;
  persona: string;
  path_prefix: string;
}

type AgentRec = Omit<Agent, "stats">;

interface PipelineRec {
  id: string;
  name: string;
  description: string;
  steps: { id: string; agent_id: string; overrides?: Record<string, unknown> }[];
  trigger: { type: "manual" | "schedule" | "webhook"; every_minutes: number | null };
  webhook_token: string | null;
  require_approval: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface ConnRec extends Omit<Connection, "secrets_set"> {
  secrets: Record<string, string>;
}

interface DatasetRec extends Omit<Dataset, "record_count"> {
  template: string | null;
}

interface PlanLog {
  frac: number;
  level: RunLog["level"];
  message: string;
}

interface StepPlan {
  step_id: string;
  agent_id: string;
  agent_name: string;
  kind: AgentKind;
  duration: number;
  items_in: number;
  items_out: number;
  logs: PlanLog[];
  fail: string | null;
  dataset_id: string | null;
  upsert: { created: number; updated: number } | null;
}

interface LiveRun {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  trigger: "manual" | "schedule" | "webhook";
  created: number;
  queue: number;
  plan: StepPlan[];
  pauseIndex: number | null;
  contentIndex: number | null; // step after which content is created (-1 = at start)
  contentCount: number;
  contentIds: string[];
  requireApproval: boolean;
  resumeAt: number | null;
  skipAt: number | null;
  cancelledAt: number | null;
  done: string[];
  final: PipelineRun | null;
}

interface Store {
  slug: string;
  agents: AgentRec[];
  pipelines: PipelineRec[];
  runs: LiveRun[];
  content: ContentItem[];
  datasets: DatasetRec[];
  records: Record<string, DatasetRecord[]>;
  connections: ConnRec[];
  apiKeys: ApiKey[];
  events: ActivityEvent[];
  topicCursor: number;
}

let registry: WsBase[] | null = null;
const stores = new Map<string, Store>();

function reg(): WsBase[] {
  if (!registry) {
    registry = WORKSPACE_SEEDS.map((s) => ({
      id: `ws_${seededHex(s.slug, 12)}`,
      slug: s.slug,
      name: s.name,
      industry: s.industry,
      brand_color: s.brand_color,
      domain: s.domain,
      timezone: s.timezone,
      modules: [...s.modules],
      blueprint: s.blueprint,
      created_at: daysAgo(s.created_days_ago),
      persona: s.persona,
      path_prefix: s.path_prefix,
    }));
  }
  return registry;
}

function seededHex(seed: string, len: number): string {
  const r = seeded(seed);
  let s = "";
  while (s.length < len) s += Math.floor(r() * 16).toString(16);
  return s;
}

function randHex(len: number): string {
  let s = "";
  while (s.length < len) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null) => (s ? new Date(s).getTime() : 0);

function wsBase(slug: string): WsBase | undefined {
  return reg().find((w) => w.slug === slug);
}

function storeFor(slug: string): Store {
  let st = stores.get(slug);
  if (!st) {
    st = seedStore(slug);
    stores.set(slug, st);
  }
  return st;
}

function activeSlug(req: DemoRequest): string {
  const w = req.workspace;
  if (w && wsBase(w)) return w;
  if (wsBase(DEMO_DEFAULT_WORKSPACE)) return DEMO_DEFAULT_WORKSPACE;
  const first = reg()[0];
  if (!first) throw new DemoError(404, "no_workspace", "No workspace exists. Create one first.");
  return first.slug;
}

function brand(ws: WsBase): BrandContext {
  return { brand: ws.name, persona: ws.persona, domain: ws.domain, industry: ws.industry, pathPrefix: ws.path_prefix };
}

function emptyStore(slug: string): Store {
  return { slug, agents: [], pipelines: [], runs: [], content: [], datasets: [], records: {}, connections: [], apiKeys: [], events: [], topicCursor: 0 };
}

function bad(message: string, code = "validation_error"): never {
  throw new DemoError(422, code, message);
}

function addEvent(st: Store, kind: ActivityEvent["kind"], message: string, status: ActivityEvent["status"], at = new Date().toISOString()) {
  const ws = wsBase(st.slug);
  st.events.unshift({ id: uid("ev_"), at, workspace: st.slug, workspace_name: ws?.name ?? st.slug, kind, message, status });
  if (st.events.length > 100) st.events.length = 100;
}

/* ====================================================================================== */
/* Seeding                                                                                */
/* ====================================================================================== */

function resolveRefs(v: unknown, refs: { conn: Map<string, string>; ds: Map<string, string> }): unknown {
  if (typeof v === "string") {
    if (v.startsWith("$conn:")) return refs.conn.get(v.slice(6)) ?? "";
    if (v.startsWith("$ds:")) return refs.ds.get(v.slice(4)) ?? "";
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => resolveRefs(x, refs));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x, refs)]));
  return v;
}

function connStatus(kind: ConnectionKind, config: Record<string, unknown>, secrets: Record<string, string>): Connection["status"] {
  const info = connectionKind(kind);
  const missing = (info?.fields ?? []).filter((f) => f.required && !(f.secret ? secrets[f.key] : config[f.key]));
  return missing.length ? "needs_setup" : "connected";
}

function missingFields(c: ConnRec): string[] {
  return (connectionKind(c.kind)?.fields ?? []).filter((f) => f.required && !(f.secret ? c.secrets[f.key] : c.config[f.key])).map((f) => f.label.toLowerCase());
}

function seedStore(slug: string): Store {
  const st = emptyStore(slug);
  const ws = wsBase(slug);
  const seed = PLATFORM_SEEDS[slug];
  if (!ws || !seed) return st;
  const rng = seeded(`seed:${slug}`);
  const refs = { conn: new Map<string, string>(), ds: new Map<string, string>() };

  for (const c of seed.connections) {
    const id = `con_${seededHex(`${slug}:con:${c.ref}`, 10)}`;
    refs.conn.set(c.ref, id);
    const secrets = Object.fromEntries(c.secrets.map((k) => [k, "seeded-secret"]));
    st.connections.push({
      id,
      name: c.name,
      kind: c.kind,
      config: clone(c.config),
      secrets,
      status: connStatus(c.kind, c.config, secrets),
      last_used_at: c.last_used_minutes_ago === null ? null : minutesAgo(c.last_used_minutes_ago),
      last_error: c.last_error ?? null,
      created_at: daysAgo(c.created_days_ago),
    });
  }

  for (const d of seed.datasets) {
    const tpl = DATASET_TEMPLATES[d.template];
    const id = `ds_${seededHex(`${slug}:ds:${d.ref}`, 10)}`;
    refs.ds.set(d.ref, id);
    st.datasets.push({
      id,
      name: tpl.name,
      slug: tpl.slug,
      description: tpl.description,
      key_field: tpl.key_field,
      fields: clone(tpl.fields),
      public: tpl.public,
      updated_at: minutesAgo(d.updated_minutes_ago),
      created_at: daysAgo(d.created_days_ago),
      template: tpl.key,
    });
    st.records[id] = tpl.rows().slice(0, d.seed).map((row, i) => ({
      id: `rec_${seededHex(`${slug}:${d.ref}:${i}`, 10)}`,
      dataset_id: id,
      key: String(row[tpl.key_field]),
      data: row,
      source_url: tpl.source(row),
      created_at: daysAgo(d.created_days_ago - Math.min(i, d.created_days_ago - 1)),
      updated_at: minutesAgo(d.updated_minutes_ago + i * 3),
    }));
  }

  const agentIds = new Map<string, string>();
  for (const a of seed.agents) {
    const id = `agt_${seededHex(`${slug}:agt:${a.ref}`, 10)}`;
    agentIds.set(a.ref, id);
    const config = resolveRefs({ ...configDefaults(a.kind), ...clone(a.config) }, refs) as Record<string, unknown>;
    st.agents.push({
      id,
      name: a.name,
      kind: a.kind,
      description: a.description,
      config,
      model: modelOf(a.kind, config),
      enabled: a.enabled ?? true,
      created_at: daysAgo(a.created_days_ago),
      updated_at: daysAgo(Math.max(1, Math.floor(a.created_days_ago / 4))),
    });
  }

  const pipeIds = new Map<string, string>();
  for (const p of seed.pipelines) {
    const id = `pip_${seededHex(`${slug}:pip:${p.ref}`, 10)}`;
    pipeIds.set(p.ref, id);
    st.pipelines.push({
      id,
      name: p.name,
      description: p.description,
      steps: p.steps.map((r, i) => ({ id: seededHex(`${slug}:${p.ref}:step${i}`, 12), agent_id: agentIds.get(r) ?? "" })),
      trigger: { type: p.trigger.type, every_minutes: p.trigger.type === "schedule" ? (p.trigger.every_minutes ?? 60) : null },
      webhook_token: p.trigger.type === "webhook" ? `whk_${seededHex(`${slug}:${p.ref}:hook`, 24)}` : null,
      require_approval: p.require_approval,
      enabled: p.enabled ?? true,
      created_at: daysAgo(p.created_days_ago),
      updated_at: daysAgo(Math.max(1, Math.floor(p.created_days_ago / 5))),
    });
  }

  const contentIds = new Map<string, string>();
  for (const c of seed.content) contentIds.set(c.ref, `cnt_${seededHex(`${slug}:cnt:${c.ref}`, 10)}`);
  const runIds = new Map<string, string>();
  for (const r of seed.runs) runIds.set(r.ref, `run_${seededHex(`${slug}:run:${r.ref}`, 10)}`);

  for (const r of seed.runs) {
    const p = st.pipelines.find((x) => x.id === pipeIds.get(r.pipeline));
    if (!p) continue;
    const created = Date.now() - r.minutes_ago * 60_000;
    const run = createRun(st, ws, p, r.trigger, {
      id: runIds.get(r.ref),
      created,
      rng: seeded(`${slug}:run:${r.ref}`),
      scale: 16,
      counts: r.counts,
      contentCount: r.content.length,
      fail: r.fail,
      notes: r.notes,
      preset: true,
    });
    run.contentIds = r.content.map((x) => contentIds.get(x) ?? "");
    // a run whose drafts were all approved (or published) in the seed was resumed at that moment
    const reviewed = r.content.map((ref) => seed.content.find((c) => c.ref === ref)).filter((c): c is NonNullable<typeof c> => !!c);
    if (run.pauseIndex !== null && reviewed.length && reviewed.every((c) => c.status === "approved" || c.status === "published")) {
      const at = Math.max(...reviewed.map((c) => (c.published_minutes_ago !== undefined ? Date.now() - (c.published_minutes_ago + 3) * 60_000 : Date.now() - (c.minutes_ago - 40) * 60_000)));
      run.resumeAt = Math.min(at, Date.now());
    }
    const v = computeRun(run, Date.now());
    const awaiting = v.status === "awaiting_approval";
    run.done = ["content", ...run.plan.map((s, i) => (s.kind === "dataset_builder" ? `ds:${i}` : "")).filter(Boolean)];
    if (!awaiting) run.done.push("publish");
    st.runs.push(run);
  }

  for (const c of seed.content) {
    const topic = TOPICS[c.topic];
    const p = c.pipeline ? st.pipelines.find((x) => x.id === pipeIds.get(c.pipeline as string)) : undefined;
    const createdMs = Date.now() - c.minutes_ago * 60_000;
    const item = makeContent(st, ws, topic, {
      id: contentIds.get(c.ref),
      status: c.status,
      run_id: c.run ? (runIds.get(c.run) ?? null) : null,
      pipeline: p ?? null,
      formats: c.formats,
      createdMs,
      quality: c.quality,
      schemaType: c.schema_type,
      maxTags: 3,
    });
    if (c.published_minutes_ago !== undefined) {
      const at = minutesAgo(c.published_minutes_ago);
      item.published_at = at;
      item.updated_at = at;
      item.publications = (c.publications ?? []).map((pub, i) => {
        const conn = st.connections.find((x) => x.id === refs.conn.get(pub.connection));
        const made = conn ? publication(conn, item, at, i + Math.floor(rng() * 900)) : null;
        if (made) {
          made.status = pub.status;
          if (pub.status !== "published") made.url = null;
          made.error = pub.error ?? null;
        }
        return made;
      }).filter((x): x is ContentPublication => !!x);
    } else if (c.status === "approved") {
      item.updated_at = iso(createdMs + 40 * 60_000);
    }
    st.content.push(item);
  }

  for (const e of seed.events) {
    st.events.push({ id: `ev_${seededHex(`${slug}:${e.message}`, 10)}`, at: minutesAgo(e.minutes_ago), workspace: slug, workspace_name: ws.name, kind: e.kind, message: e.message, status: e.status });
  }

  for (const k of seed.api_keys) {
    st.apiKeys.push({
      id: `key_${seededHex(`${slug}:key:${k.prefix}`, 10)}`,
      name: k.name,
      prefix: k.prefix,
      scopes: [...k.scopes],
      last_used_at: k.last_used_minutes_ago === null ? null : minutesAgo(k.last_used_minutes_ago),
      created_at: daysAgo(k.created_days_ago),
      revoked: false,
    });
  }
  st.topicCursor = 0;
  return st;
}

function modelOf(kind: AgentKind, config: Record<string, unknown>, explicit?: unknown): string {
  if (typeof explicit === "string" && explicit) return explicit;
  if (typeof config.model === "string" && config.model) return config.model;
  return agentType(kind)?.default_model ?? "fast";
}

/* ====================================================================================== */
/* Content                                                                                */
/* ====================================================================================== */

function uniqueSlug(base: string, taken: (s: string) => boolean): string {
  let s = base || "item";
  let n = 2;
  while (taken(s)) s = `${base}-${n++}`;
  return s;
}

function agentOf(st: Store, id: string): AgentRec | undefined {
  return st.agents.find((a) => a.id === id);
}

function pipelineAgents(st: Store, p: PipelineRec): AgentRec[] {
  return p.steps.map((s) => agentOf(st, s.agent_id)).filter((a): a is AgentRec => !!a);
}

function formatsFor(st: Store, p: PipelineRec | null): ContentFormat[] {
  if (!p) return ["article"];
  const agents = pipelineAgents(st, p);
  const multi = agents.find((a) => a.kind === "multi_format");
  const pub = agents.find((a) => a.kind === "auto_publisher");
  const base = Array.isArray(multi?.config.formats) ? (multi?.config.formats as ContentFormat[]) : ["article" as ContentFormat];
  const extra = Array.isArray(pub?.config.formats) ? (pub?.config.formats as ContentFormat[]) : [];
  return [...new Set([...base, ...extra])].filter((f) => ALL_FORMATS.includes(f));
}

function makeContent(
  st: Store,
  ws: WsBase,
  topic: TopicSpec,
  o: {
    id?: string;
    status: ContentStatus;
    run_id: string | null;
    pipeline: PipelineRec | null;
    formats: ContentFormat[];
    createdMs: number;
    quality: { score: number; flags: string[] } | null;
    schemaType: string | null;
    maxTags: number;
  },
): ContentItem {
  const ctx = brand(ws);
  const base = slugFor(topic);
  const slug = uniqueSlug(base, (s) => st.content.some((c) => c.slug === s));
  const createdAt = iso(o.createdMs);
  const variants: ContentVariant[] = o.formats.map((f) => buildVariant(topic, f, ctx, { maxTags: o.maxTags, slug }));
  const images = demoImages(`${ws.slug}:${slug}`, themeFor(ws.industry, topic.tags.join(" ")), { pageUrl: topic.source_url, sourceName: topic.source_name, title: topic.title });
  return {
    id: o.id ?? uid("cnt_"),
    run_id: o.run_id,
    pipeline_id: o.pipeline?.id ?? null,
    pipeline_name: o.pipeline?.name ?? null,
    title: topic.title,
    slug,
    summary: topic.summary,
    source_url: topic.source_url,
    source_name: topic.source_name,
    persona: ws.persona.split(",")[0],
    status: o.status,
    tags: [...topic.tags],
    image_url: images[0]?.url ?? null,
    images,
    seo: o.schemaType ? buildSeo(topic, ctx, o.schemaType, createdAt, slug) : null,
    quality: o.quality,
    variants,
    publications: [],
    created_at: createdAt,
    updated_at: createdAt,
    published_at: null,
  };
}

function pickFormat(kind: ConnectionKind, item: ContentItem): ContentFormat {
  const has = (f: ContentFormat) => item.variants.some((v) => v.format === f);
  const pref: Partial<Record<ConnectionKind, ContentFormat[]>> = {
    nextjs: ["article", "blog_post"],
    wordpress: ["blog_post", "article"],
    ghost: ["blog_post", "article"],
    webhook: ["article", "blog_post"],
    linkedin: ["linkedin_post", "article"],
    telegram: ["whatsapp_message", "article"],
    x: ["x_thread", "article"],
  };
  return (pref[kind] ?? ["article", "blog_post"]).find(has) ?? item.variants[0]?.format ?? "article";
}

function publication(conn: ConnRec, item: ContentItem, at: string, n: number): ContentPublication {
  const format = pickFormat(conn.kind, item);
  const base: ContentPublication = { connection_id: conn.id, connection_name: conn.name, kind: conn.kind, format, status: "published", url: null, error: null, at };
  if (conn.status !== "connected") {
    const miss = missingFields(conn);
    return { ...base, status: "failed", error: conn.last_error ?? `Connection needs setup${miss.length ? `: missing ${miss.join(", ")}` : ""}` };
  }
  if (connectionKind(conn.kind)?.auto_publish === false) return { ...base, status: "manual" };
  const site = String(conn.config.site_url ?? conn.config.api_url ?? "").replace(/\/$/, "");
  switch (conn.kind) {
    case "nextjs": {
      const tpl = String(conn.config.path_template || "/news/{slug}");
      base.url = `${site}${tpl.replace("{slug}", item.slug)}`;
      break;
    }
    case "wordpress":
    case "ghost":
      base.url = `${site}/${item.slug}/`;
      break;
    case "linkedin":
      base.url = `https://www.linkedin.com/feed/update/urn:li:activity:73${String(1000000000000000 + n * 7919 + item.slug.length * 104729).slice(0, 15)}`;
      break;
    case "telegram":
      base.url = `https://t.me/${String(conn.config.chat_id ?? "channel").replace(/^@/, "")}/${2400 + (n % 900)}`;
      break;
    default:
      base.url = null;
  }
  return base;
}

function publishItem(st: Store, item: ContentItem, connIds: string[], at: string) {
  const conns = connIds.map((id) => st.connections.find((c) => c.id === id)).filter((c): c is ConnRec => !!c);
  const pubs = conns.map((c, i) => publication(c, item, at, st.content.length * 13 + i * 31 + Math.floor(Math.random() * 500)));
  for (const c of conns) c.last_used_at = at;
  const keep = item.publications.filter((p) => !connIds.includes(p.connection_id));
  item.publications = [...keep, ...pubs];
  const okCount = pubs.filter((p) => p.status !== "failed").length;
  item.status = okCount > 0 || pubs.length === 0 ? "published" : "failed";
  item.published_at = item.status === "published" ? at : item.published_at;
  item.updated_at = at;
}

function defaultPublishTargets(st: Store, item: ContentItem): string[] {
  const p = item.pipeline_id ? st.pipelines.find((x) => x.id === item.pipeline_id) : undefined;
  const pub = p ? pipelineAgents(st, p).find((a) => a.kind === "auto_publisher") : undefined;
  const ids = Array.isArray(pub?.config.connections) ? (pub?.config.connections as string[]) : [];
  const valid = ids.filter((id) => st.connections.some((c) => c.id === id));
  return valid.length ? valid : st.connections.filter((c) => c.status === "connected").map((c) => c.id);
}

/* ====================================================================================== */
/* Run engine                                                                             */
/* ====================================================================================== */

const CREATE_KINDS: AgentKind[] = ["persona_rewriter", "multi_format", "custom_llm"];

function host(url: unknown): string {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "source");
  }
}

function personaName(config: Record<string, unknown>): string | null {
  const m = String(config.persona ?? "").match(/You are ([A-Z][a-z]+)(?: [A-Z][a-z]+)?/);
  return m ? m[1] : null;
}

function datasetName(st: Store, id: unknown): string {
  return st.datasets.find((d) => d.id === id)?.name ?? "the dataset";
}

function templateFor(ds: DatasetRec | undefined): DatasetTemplate | undefined {
  if (!ds) return undefined;
  if (ds.template && DATASET_TEMPLATES[ds.template]) return DATASET_TEMPLATES[ds.template];
  const keys = new Set(ds.fields.map((f) => f.key));
  return Object.values(DATASET_TEMPLATES).find((t) => t.key_field === ds.key_field && t.fields.filter((f) => keys.has(f.key)).length >= 3);
}

interface PlanOpts {
  id?: string;
  created?: number;
  rng: () => number;
  scale: number;
  counts?: number[];
  contentCount?: number;
  fail?: { step: number; error: string };
  notes?: Record<number, string[]>;
  preset?: boolean;
}

function createRun(st: Store, ws: WsBase, p: PipelineRec, trigger: LiveRun["trigger"], o: PlanOpts): LiveRun {
  const rng = o.rng;
  const steps = p.steps.map((s) => ({ s, agent: agentOf(st, s.agent_id) }));
  const kinds = steps.map((x) => x.agent?.kind ?? "custom_llm");
  const n = steps.length;
  const pubIdx = kinds.indexOf("auto_publisher");
  const hasBuilder = kinds.includes("dataset_builder");
  const createsContent = pubIdx >= 0 || (kinds.some((k) => CREATE_KINDS.includes(k)) && !hasBuilder);
  const contentCount = o.contentCount ?? (createsContent ? 1 + (rng() < 0.45 ? 1 : 0) : 0);
  const contentIndex = createsContent ? (pubIdx >= 0 ? pubIdx - 1 : n - 1) : null;
  const pauseIndex = p.require_approval && pubIdx >= 0 && contentCount > 0 ? pubIdx : null;

  // items flowing through the steps
  const outs: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = i === 0 ? 0 : outs[i - 1];
    const cfg = { ...(steps[i].agent?.config ?? {}), ...(steps[i].s.overrides ?? {}) };
    let out: number;
    switch (kinds[i]) {
      case "web_scraper":
        out = prev > 0 ? prev : 34 + Math.floor(rng() * 12);
        break;
      case "news_monitor":
        out = 18 + Math.floor(rng() * 14);
        break;
      case "dataset_builder":
        out = cfg.source_mode === "pipeline_items" && prev > 0 ? prev : prev > 0 ? prev : 5 + Math.floor(rng() * 4);
        break;
      case "data_transform":
        out = Math.max(1, Math.round(prev * (0.38 + rng() * 0.1)));
        break;
      case "persona_rewriter":
      case "custom_llm":
        out = hasBuilder ? prev : Math.min(prev || 1, 4 + Math.floor(rng() * 3));
        break;
      case "quality_gate":
        out = createsContent ? contentCount : Math.max(0, prev - 1);
        break;
      case "auto_publisher":
        out = contentCount;
        break;
      case "link_collector":
        out = prev > 0 ? prev : 110 + Math.floor(rng() * 40);
        break;
      case "document_reader":
        out = prev > 0 ? Math.min(prev, 6) : 1 + Math.floor(rng() * 2);
        break;
      case "page_watcher":
        out = rng() < 0.6 ? 1 : 2;
        break;
      case "keyword_researcher":
        out = 120 + Math.floor(rng() * 40);
        break;
      case "comparer":
        out = prev > 0 ? Math.max(1, Math.round(prev / 3)) : 6;
        break;
      default:
        out = prev;
    }
    if (o.counts && o.counts[i] !== undefined) out = o.counts[i];
    outs.push(out);
  }
  if (!o.counts && createsContent && contentIndex !== null && contentIndex >= 0) {
    outs[contentIndex] = contentCount;
    // a quality gate does the dropping itself; otherwise the create steps already produce exactly the drafts
    if (kinds[contentIndex] !== "quality_gate") {
      for (let j = contentIndex - 1; j >= 0 && CREATE_KINDS.concat("seo_optimizer").includes(kinds[j]); j--) outs[j] = contentCount;
    }
  }

  const plan: StepPlan[] = steps.map(({ s, agent }, i) => {
    const kind = kinds[i];
    const cfg = { ...(agent?.config ?? {}), ...(s.overrides ?? {}) };
    const itemsIn = i === 0 ? 0 : outs[i - 1];
    const itemsOut = outs[i];
    const llm = agentType(kind)?.uses_model && kind !== "data_transform";
    const duration = Math.round((1500 + rng() * 1000) * o.scale * (o.scale > 1 && llm ? 1.6 : 1));
    const dsId = kind === "dataset_builder" && typeof cfg.dataset === "string" ? cfg.dataset : null;
    let upsert: StepPlan["upsert"] = null;
    if (kind === "dataset_builder" && dsId) {
      const ds = st.datasets.find((d) => d.id === dsId);
      const existing = st.records[dsId] ?? [];
      const tpl = templateFor(ds);
      const available = tpl ? tpl.rows().filter((r) => !existing.some((e) => e.key.toLowerCase() === String(r[tpl.key_field]).toLowerCase())).length : 2;
      const created = o.preset ? 0 : Math.min(available, itemsOut, existing.length < 3 ? 5 : 1 + (rng() < 0.5 ? 1 : 0));
      const updated = Math.min(existing.length, Math.max(0, itemsOut - created));
      upsert = { created, updated };
    }
    const logs = stepLogs(st, ws, kind, agent, cfg, itemsIn, itemsOut, upsert, rng);
    if (contentIndex === i && contentCount > 0) {
      logs.push({
        frac: 0.97,
        level: "info",
        message: `Saved ${contentCount} content draft${contentCount > 1 ? "s" : ""}${pauseIndex !== null ? " · waiting for approval before publishing" : ""}`,
      });
    }
    for (const note of o.notes?.[i] ?? []) logs.push({ frac: 0.95, level: "info", message: note });
    logs.sort((a, b) => a.frac - b.frac);
    return {
      step_id: s.id,
      agent_id: s.agent_id,
      agent_name: agent?.name ?? "Deleted agent",
      kind,
      duration,
      items_in: itemsIn,
      items_out: itemsOut,
      logs,
      fail: o.fail && o.fail.step === i ? o.fail.error : null,
      dataset_id: dsId,
      upsert,
    };
  });
  if (o.fail && plan[o.fail.step]) {
    // a failing step keeps only its first lines before the error
    const fs = plan[o.fail.step];
    fs.logs = fs.logs.filter((l) => l.level !== "info" || l.frac < 0.7).filter((l) => !/^Saved/.test(l.message));
  }

  return {
    id: o.id ?? uid("run_"),
    pipeline_id: p.id,
    pipeline_name: p.name,
    trigger,
    created: o.created ?? Date.now(),
    queue: o.scale > 1 ? 4000 : 800,
    plan,
    pauseIndex,
    contentIndex,
    contentCount,
    contentIds: [],
    requireApproval: p.require_approval,
    resumeAt: null,
    skipAt: null,
    cancelledAt: null,
    done: [],
    final: null,
  };
}

function stepLogs(
  st: Store,
  ws: WsBase,
  kind: AgentKind,
  agent: AgentRec | undefined,
  cfg: Record<string, unknown>,
  inN: number,
  outN: number,
  upsert: StepPlan["upsert"],
  rng: () => number,
): PlanLog[] {
  const L = (frac: number, message: string, level: RunLog["level"] = "info"): PlanLog => ({ frac, level, message });
  const sources = Array.isArray(cfg.sources) ? (cfg.sources as { url?: string }[]) : [];
  const hosts = [...new Set(sources.map((s) => host(s.url)))];
  const hostList = hosts.length ? `${hosts.slice(0, 3).join(", ")}${hosts.length > 3 ? ` +${hosts.length - 3} more` : ""}` : "Google News";
  const model = MODEL_TAGS[agent?.model ?? ""] ?? agent?.model ?? MODEL_TAGS.fast;
  switch (kind) {
    case "news_monitor": {
      const dropped = 6 + Math.floor(rng() * 12);
      const kw = Array.isArray(cfg.keywords) ? (cfg.keywords as string[]) : [];
      return [
        L(0.05, `Polling ${Math.max(1, sources.length)} feed${sources.length === 1 ? "" : "s"}: ${hostList}`),
        L(0.55, `Fetched ${Math.max(1, sources.length)} feeds · ${outN + dropped} items`),
        L(0.9, `Kept ${outN} items${kw.length ? ` matching ${kw.slice(0, 3).join(", ")}` : ""} · dropped ${dropped} older than ${cfg.lookback_hours ?? 24}h or duplicates`),
      ];
    }
    case "web_scraper": {
      const fields = Array.isArray(cfg.extract_fields) ? cfg.extract_fields.length : 0;
      const extra = 3 + Math.floor(rng() * 6);
      const logs = [
        L(0.05, `Crawling ${Math.max(1, sources.length)} source${sources.length === 1 ? "" : "s"}: ${hostList}`),
        L(0.4, `Found ${outN + extra} listings${cfg.follow_links ? " · following detail pages" : ""}`),
        L(
          0.85,
          cfg.extraction === "css"
            ? `Extracted ${fields} fields with CSS selectors · ${outN} items`
            : `Extracted ${fields || "all"} fields per item with ${model} · ${outN} items (${extra} pages had no event data)`,
        ),
      ];
      if (hosts.length > 1 && rng() < 0.5) logs.splice(2, 0, L(0.6, `${hosts[1]}: 2 pages timed out, retried once`, "warn"));
      return logs;
    }
    case "data_transform": {
      const removed = Math.max(0, inN - outN);
      const dedupe = Array.isArray(cfg.dedupe_by) ? (cfg.dedupe_by as string[]) : [];
      const filters = parseFilters(cfg.filters);
      const dupes = dedupe.length ? Math.round(removed * 0.3) : 0;
      const filtered = removed - dupes;
      const logs: PlanLog[] = [];
      if (dedupe.length) logs.push(L(0.15, `Deduplicated by ${dedupe.join(", ")} · removed ${dupes}`));
      filters.forEach((f, i) => {
        const part = i === filters.length - 1 ? filtered - Math.floor(filtered / filters.length) * (filters.length - 1) : Math.floor(filtered / filters.length);
        logs.push(L(0.35 + i * 0.1, `Filter ${f.field} ${f.op}${f.value !== undefined ? ` ${JSON.stringify(f.value)}` : ""} · removed ${part}`));
      });
      if (cfg.sort_by) logs.push(L(0.6, `Sorted by ${cfg.sort_by} ${cfg.sort_order ?? "asc"} · kept ${outN} (limit ${cfg.limit ?? 50})`));
      if (cfg.ai_categorize) {
        const cats = Array.isArray(cfg.categories) ? (cfg.categories as string[]) : [];
        const dist = distribute(outN, cats.length || 1, rng);
        const text = cats.length ? cats.map((c, i) => `${c} ${dist[i]}`).filter((_, i) => dist[i] > 0).join(" · ") : `${outN}`;
        logs.push(L(0.9, `AI-categorized ${outN} items into ${cfg.category_field ?? "category"}: ${text}`));
      }
      if (!logs.length) logs.push(L(0.5, `Passed ${outN} of ${inN} items`));
      return logs;
    }
    case "persona_rewriter": {
      const who = personaName(cfg);
      return [
        L(0.08, `Rewriting ${inN} item${inN === 1 ? "" : "s"} with ${model} (${cfg.tone ?? "analytical"}, ${cfg.length ?? "medium"})`),
        ...(inN > outN ? [L(0.3, `Skipped ${inN - outN} low-relevance items`)] : []),
        L(0.9, `Rewrote ${outN} item${outN === 1 ? "" : "s"} in ${who ? `${who}'s` : "the house"} voice`),
      ];
    }
    case "multi_format": {
      const formats = Array.isArray(cfg.formats) ? (cfg.formats as string[]) : [];
      const logs = [L(0.08, `Generating ${formats.length} formats × ${inN} item${inN === 1 ? "" : "s"} with ${model}`)];
      if (formats.includes("x_thread")) logs.push(L(0.55, `X thread: ${6 + Math.floor(rng() * 2)} tweets, longest ${240 + Math.floor(rng() * 38)} chars`));
      logs.push(L(0.9, `Created ${formats.length * outN} variants (${formats.slice(0, 4).join(", ")}${formats.length > 4 ? ", …" : ""})`));
      return logs;
    }
    case "seo_optimizer": {
      const kw = Array.isArray(cfg.focus_keywords) ? (cfg.focus_keywords as string[]) : [];
      return [
        L(0.2, `Wrote title tags (≤${cfg.title_max ?? 60} chars) and meta descriptions for ${inN} item${inN === 1 ? "" : "s"}`),
        L(0.8, `Added ${cfg.schema_type ?? "Article"} JSON-LD${kw.length ? ` · focus keywords: ${kw.slice(0, 2).join(", ")}` : ""}`),
      ];
    }
    case "quality_gate": {
      const avg = 76 + Math.floor(rng() * 16);
      const dropped = Math.max(0, inN - outN);
      const dup = Math.min(dropped, Math.ceil(dropped / 2));
      const logs = [L(0.25, `Scored ${inN} item${inN === 1 ? "" : "s"} · average ${avg}/100 (min ${cfg.min_score ?? 70})`)];
      if (dropped) logs.push(L(0.6, `Dropped ${dropped} item${dropped === 1 ? "" : "s"} (${dup} duplicate${dup === 1 ? "" : "s"}, ${dropped - dup} below min score)`, outN === 0 ? "warn" : "info"));
      logs.push(L(0.85, outN ? `Passed ${outN} item${outN === 1 ? "" : "s"}` : "No items passed the quality gate", outN ? "info" : "warn"));
      return logs;
    }
    case "auto_publisher": {
      if (inN === 0 && outN === 0) return [L(0.5, "Nothing to publish")];
      const ids = Array.isArray(cfg.connections) ? (cfg.connections as string[]) : [];
      const conns = ids.map((id) => st.connections.find((c) => c.id === id)).filter((c): c is ConnRec => !!c);
      if (!conns.length) return [L(0.5, "No connections selected: content kept as approved", "warn")];
      return conns.map((c, i) => {
        const frac = 0.2 + (0.7 * i) / Math.max(1, conns.length);
        if (c.status !== "connected") return L(frac, `${c.name}: skipped, connection needs setup`, "warn");
        if (connectionKind(c.kind)?.auto_publish === false) return L(frac, `${c.name}: thread prepared for manual posting`);
        if (c.kind === "nextjs" || c.kind === "webhook") return L(frac, `${c.name}: delivered content.published (200 in ${180 + Math.floor(rng() * 300)} ms)`);
        if (c.kind === "linkedin") return L(frac, `${c.name}: posted`);
        if (c.kind === "telegram") return L(frac, `${c.name}: message sent`);
        return L(frac, `${c.name}: published`);
      });
    }
    case "dataset_builder": {
      const name = datasetName(st, cfg.dataset);
      const u = upsert ?? { created: 0, updated: outN };
      const unchanged = Math.max(0, outN - u.created - u.updated);
      const head =
        cfg.source_mode === "pipeline_items"
          ? L(0.1, `Received ${inN} items from the previous step`)
          : L(0.1, `Scraping ${Math.max(1, sources.length)} source${sources.length === 1 ? "" : "s"} for ${name}: ${hostList}`);
      return [
        head,
        ...(cfg.source_mode === "pipeline_items" ? [] : [L(0.55, `Extracted ${outN} records with ${model}`)]),
        L(0.9, `Upserted into ${name}: ${u.created} new, ${u.updated} updated${unchanged ? `, ${unchanged} unchanged` : ""}`),
      ];
    }
    case "link_collector": {
      const starts = Array.isArray(cfg.start_urls) ? (cfg.start_urls as string[]) : [];
      const pats = Array.isArray(cfg.include_patterns) ? (cfg.include_patterns as string[]) : [];
      const total = Math.round(outN * 2.4) + 4;
      return [
        L(0.1, `Reading ${Math.max(1, starts.length)} start page${starts.length === 1 ? "" : "s"}${cfg.use_sitemap === false ? "" : " + sitemap.xml"}: ${starts.slice(0, 2).map(host).join(", ") || "your site"}`),
        L(0.6, `Collected ${total} links · removed ${Math.round(total * 0.18)} duplicates and tracking parameters`),
        L(0.9, `Kept ${outN} matching ${pats.length ? pats.join(", ") : "the same site"}`),
      ];
    }
    case "document_reader": {
      const name = (() => {
        const u = String(sources[0]?.url ?? "fees-2026.pdf");
        return u.split("/").pop() || u;
      })();
      const pages = 8 + Math.floor(rng() * 12);
      return [
        L(0.1, `Downloading ${Math.max(1, sources.length)} document${sources.length === 1 ? "" : "s"}: ${name}`),
        L(0.5, `Read ${pages} pages from ${name}`),
        L(0.9, `Extracted ${Array.isArray(cfg.extract_fields) ? cfg.extract_fields.length || "the main" : "the main"} fields with ${model} · ${outN} item${outN === 1 ? "" : "s"}`),
      ];
    }
    case "page_watcher": {
      const n = Math.max(1, sources.length);
      return [
        L(0.2, `Checked ${n} page${n === 1 ? "" : "s"}${cfg.watch_selector ? ` (only ${cfg.watch_selector})` : ""}`),
        L(0.85, `${outN} changed: price ₹54,999 → ₹51,999${outN > 1 ? " · new notice “Last date extended to 30 Nov”" : ""}`),
      ];
    }
    case "keyword_researcher": {
      const seeds = Array.isArray(cfg.seed_keywords) ? (cfg.seed_keywords as string[]) : [];
      return [
        L(0.2, `Expanding ${seeds.length || 1} seed keyword${seeds.length === 1 ? "" : "s"} with search suggestions (${String(cfg.country ?? "in").toUpperCase()})`),
        L(0.6, `Read ${Array.isArray(cfg.competitor_urls) ? cfg.competitor_urls.length : 0} competitor pages for extra terms`),
        L(0.9, `${outN} ideas in 4 intent groups (learn, compare, buy, local)`),
      ];
    }
    case "image_finder":
      return [
        L(0.2, `Looking for images for ${inN || outN} item${(inN || outN) === 1 ? "" : "s"} (Openverse and Wikimedia Commons first)`),
        L(0.85, `Found ${Math.max(1, outN) * 2} images · ${Math.max(1, outN)} with an open licence · duplicates removed by image hash`),
      ];
    case "comparer": {
      return [
        L(0.3, `Matching ${inN || outN * 3} items on ${cfg.match_field ?? "name"} across 3 shops`),
        L(0.9, `Matched ${outN} products across 3 shops · best price at Croma for ${Math.max(1, Math.round(outN / 2))}`),
      ];
    }
    case "comparison_assistant":
      return [L(0.5, `Indexed ${(st.records[String(cfg.dataset)] ?? []).length} records from ${datasetName(st, cfg.dataset)} for the assistant`)];
    case "custom_llm":
    default:
      return [L(0.1, `Running prompt on ${inN} item${inN === 1 ? "" : "s"} with ${model}`), L(0.9, `Filled ${Array.isArray(cfg.output_fields) ? cfg.output_fields.length : 0} output fields for ${outN} items`)];
  }
  void ws;
}

function distribute(total: number, buckets: number, rng: () => number): number[] {
  const w = Array.from({ length: buckets }, (_, i) => (i === 0 ? 3 : 1) + rng() * 1.5);
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.floor((x / sum) * total));
  let left = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % buckets, left--) out[i]++;
  return out;
}

interface Span {
  start: number;
  end: number;
}

function schedule(run: LiveRun): { spans: (Span | null)[]; pausedAt: number | null; endAt: number | null; failedIdx: number | null; skipped: boolean } {
  const spans: (Span | null)[] = run.plan.map(() => null);
  let t = run.created + run.queue;
  let pausedAt: number | null = null;
  let failedIdx: number | null = null;
  let endAt: number | null = null;
  let skipped = false;
  let complete = true;
  for (let i = 0; i < run.plan.length; i++) {
    if (run.pauseIndex === i) {
      pausedAt = t;
      if (run.skipAt !== null) {
        endAt = Math.max(t, run.skipAt);
        skipped = true;
        complete = false;
        break;
      }
      if (run.resumeAt === null) {
        complete = false;
        break;
      }
      t = Math.max(t, run.resumeAt);
    }
    const span = { start: t, end: t + run.plan[i].duration };
    spans[i] = span;
    t = span.end;
    if (run.plan[i].fail) {
      failedIdx = i;
      endAt = t;
      complete = false;
      break;
    }
  }
  if (complete) endAt = t;
  return { spans, pausedAt, endAt, failedIdx, skipped };
}

function computeRun(run: LiveRun, now: number): PipelineRun {
  const sch = schedule(run);
  const cancelled = run.cancelledAt !== null && (sch.endAt === null || run.cancelledAt < sch.endAt);
  const eff = cancelled ? Math.min(now, run.cancelledAt as number) : now;
  const startedMs = run.created + run.queue;
  const terminal = cancelled ? now >= (run.cancelledAt as number) : sch.endAt !== null && eff >= sch.endAt;
  let status: RunStatus;
  if (cancelled && terminal) status = "cancelled";
  else if (terminal) status = sch.failedIdx !== null ? "failed" : "succeeded";
  else if (eff < startedMs) status = "queued";
  else if (sch.pausedAt !== null && eff >= sch.pausedAt && run.resumeAt === null && run.skipAt === null) status = "awaiting_approval";
  else status = "running";

  const steps: RunStep[] = run.plan.map((p, i) => {
    const span = sch.spans[i];
    const logs: RunLog[] = [];
    let st: StepStatus = "pending";
    let error: string | null = null;
    if (span) for (const l of p.logs) if (span.start + l.frac * p.duration <= eff) logs.push({ at: iso(span.start + l.frac * p.duration), level: l.level, message: l.message });
    if (!span || eff < span.start) {
      st = status === "cancelled" || status === "failed" || status === "succeeded" ? "skipped" : "pending";
      if (sch.skipped && run.pauseIndex === i) logs.push({ at: iso(run.skipAt as number), level: "warn", message: "Every draft was rejected: nothing to publish" });
    } else if (eff < span.end) {
      if (status === "cancelled") {
        st = "skipped";
        logs.push({ at: iso(run.cancelledAt as number), level: "warn", message: "Cancelled by operator" });
      } else st = "running";
    } else if (p.fail) {
      st = "failed";
      error = p.fail;
      logs.push({ at: iso(span.end), level: "error", message: p.fail });
    } else st = "succeeded";
    const started = st !== "pending" && span && eff >= span.start;
    const finished = st === "succeeded" || st === "failed";
    return {
      step_id: p.step_id,
      agent_id: p.agent_id,
      agent_name: p.agent_name,
      kind: p.kind,
      status: st,
      started_at: started && span ? iso(span.start) : null,
      finished_at: finished && span ? iso(span.end) : null,
      duration_ms: finished && span ? span.end - span.start : null,
      items_in: started ? p.items_in : 0,
      items_out: finished ? p.items_out : 0,
      logs,
      error,
    };
  });

  let finishedMs: number | null = null;
  if (status === "cancelled") finishedMs = run.cancelledAt;
  else if (status === "succeeded" || status === "failed") finishedMs = sch.endAt;
  const lastDone = [...steps].reverse().find((s) => s.status === "succeeded" || s.status === "failed");
  const failedStep = steps.find((s) => s.status === "failed");
  return {
    id: run.id,
    pipeline_id: run.pipeline_id,
    pipeline_name: run.pipeline_name,
    status,
    trigger: run.trigger,
    started_at: eff >= startedMs ? iso(startedMs) : null,
    finished_at: finishedMs !== null ? iso(finishedMs) : null,
    duration_ms: finishedMs !== null && eff >= startedMs ? finishedMs - startedMs : null,
    items_out: lastDone?.items_out ?? 0,
    content_created: run.done.includes("content") ? run.contentIds.length : 0,
    error: failedStep ? `${failedStep.agent_name}: ${failedStep.error}` : null,
    steps,
    created_at: iso(run.created),
  };
}

function runView(run: LiveRun): PipelineRun {
  return run.final ? run.final : computeRun(run, Date.now());
}

const TERMINAL: RunStatus[] = ["succeeded", "failed", "cancelled"];

function tickStore(st: Store) {
  const now = Date.now();
  const ws = wsBase(st.slug);
  if (!ws) return;
  for (const run of st.runs) {
    if (run.final) continue;
    const v = computeRun(run, now);
    const sch = schedule(run);
    // dataset upserts
    run.plan.forEach((p, i) => {
      if (p.kind !== "dataset_builder" || run.done.includes(`ds:${i}`)) return;
      if (v.steps[i].status !== "succeeded") return;
      run.done.push(`ds:${i}`);
      upsertFromRun(st, p, iso(sch.spans[i]?.end ?? now));
    });
    // content drafts
    if (run.contentIndex !== null && !run.done.includes("content") && run.contentCount > 0) {
      const reached = run.contentIndex === -1 ? v.started_at !== null : v.steps[run.contentIndex]?.status === "succeeded";
      if (reached) {
        run.done.push("content");
        const at = run.contentIndex === -1 ? run.created + run.queue : (sch.spans[run.contentIndex]?.end ?? now);
        const p = st.pipelines.find((x) => x.id === run.pipeline_id) ?? null;
        for (let k = 0; k < run.contentCount; k++) {
          const item = draftFromRun(st, ws, p, run, at + k * 1000);
          st.content.unshift(item);
          run.contentIds.push(item.id);
        }
      }
    } else if (run.contentIndex !== null && !run.done.includes("content") && run.contentCount === 0) {
      run.done.push("content");
    }
    // publishing
    const pubIdx = run.plan.findIndex((p) => p.kind === "auto_publisher");
    if (pubIdx >= 0 && !run.done.includes("publish") && v.steps[pubIdx]?.status === "succeeded") {
      run.done.push("publish");
      const at = iso(sch.spans[pubIdx]?.end ?? now);
      const agent = agentOf(st, run.plan[pubIdx].agent_id);
      const ids = Array.isArray(agent?.config.connections) ? (agent?.config.connections as string[]) : [];
      for (const id of run.contentIds) {
        const item = st.content.find((c) => c.id === id);
        if (!item) continue;
        const eligible = run.requireApproval ? item.status === "approved" : item.status === "draft" || item.status === "approved";
        if (eligible) publishItem(st, item, ids, at);
      }
    }
    if (TERMINAL.includes(v.status)) run.final = computeRun(run, now);
  }
}

function draftFromRun(st: Store, ws: WsBase, p: PipelineRec | null, run: LiveRun, atMs: number): ContentItem {
  const pool = TOPIC_POOLS[ws.slug] ?? TOPIC_POOLS[ws.industry] ?? TOPIC_POOLS.other;
  const topic = TOPICS[pool[st.topicCursor++ % pool.length]];
  const agents = p ? pipelineAgents(st, p) : [];
  const multi = agents.find((a) => a.kind === "multi_format");
  const seo = agents.find((a) => a.kind === "seo_optimizer");
  const quality = agents.find((a) => a.kind === "quality_gate");
  const rng = seeded(`${run.id}:${atMs}`);
  const flags = rng() < 0.35 ? ["One figure could not be matched to the source: check before approving"] : [];
  return makeContent(st, ws, topic, {
    status: "draft",
    run_id: run.id,
    pipeline: p,
    formats: formatsFor(st, p),
    createdMs: atMs,
    quality: quality ? { score: 78 + Math.floor(rng() * 18) - flags.length * 6, flags } : null,
    schemaType: seo ? String(seo.config.schema_type ?? "Article") : null,
    maxTags: multi?.config.hashtags === false ? 0 : Number(multi?.config.max_hashtags ?? 3),
  });
}

function upsertFromRun(st: Store, step: StepPlan, at: string) {
  const ds = st.datasets.find((d) => d.id === step.dataset_id);
  if (!ds || !step.upsert) return;
  const list = (st.records[ds.id] ??= []);
  const tpl = templateFor(ds);
  let created = 0;
  if (tpl) {
    const fresh = tpl.rows().filter((r) => !list.some((e) => e.key.toLowerCase() === String(r[tpl.key_field] ?? "").toLowerCase()));
    for (const row of fresh.slice(0, step.upsert.created)) {
      const data = Object.fromEntries(ds.fields.map((f) => [f.key, row[f.key] ?? null]));
      list.push({ id: uid("rec_"), dataset_id: ds.id, key: String(data[ds.key_field] ?? row[tpl.key_field]), data, source_url: tpl.source(row), created_at: at, updated_at: at });
      created++;
    }
  } else {
    for (let i = 0; i < step.upsert.created; i++) {
      const data = sampleRow(ds, list.length + 1);
      list.push({ id: uid("rec_"), dataset_id: ds.id, key: String(data[ds.key_field]), data, source_url: null, created_at: at, updated_at: at });
      created++;
    }
  }
  const updatable = list.filter((r) => r.created_at !== at);
  for (const r of updatable.slice(0, step.upsert.updated)) {
    r.updated_at = at;
    if (typeof r.data.subscription === "number") r.data.subscription = +(r.data.subscription * 1.08).toFixed(1);
  }
  ds.updated_at = at;
  void created;
}

function sampleRow(ds: DatasetRec, n: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of ds.fields) {
    switch (f.type) {
      case "number":
      case "currency":
        out[f.key] = 100 * n;
        break;
      case "rating":
        out[f.key] = 4;
        break;
      case "boolean":
        out[f.key] = true;
        break;
      case "date":
        out[f.key] = new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
        break;
      case "list":
        out[f.key] = ["sample"];
        break;
      case "url":
        out[f.key] = `https://example.com/${n}`;
        break;
      default:
        out[f.key] = f.key === ds.key_field ? `${ds.name} record ${n}` : "—";
    }
  }
  return out;
}

/* ====================================================================================== */
/* Views + stats                                                                          */
/* ====================================================================================== */

function summary(r: PipelineRun): PipelineRunSummary {
  return { id: r.id, status: r.status, trigger: r.trigger, started_at: r.started_at, finished_at: r.finished_at, duration_ms: r.duration_ms, items_out: r.items_out, content_created: r.content_created };
}

function allViews(st: Store): PipelineRun[] {
  return st.runs.map(runView).sort((a, b) => ms(b.created_at) - ms(a.created_at));
}

function agentStats(views: PipelineRun[], agentId: string): AgentStats {
  let runs = 0;
  let ok = 0;
  let total = 0;
  let last: string | null = null;
  for (const v of views) {
    for (const s of v.steps) {
      if (s.agent_id !== agentId) continue;
      if (s.started_at && (!last || s.started_at > last)) last = s.started_at;
      if (s.status === "succeeded" || s.status === "failed") {
        runs++;
        if (s.status === "succeeded") ok++;
        total += s.duration_ms ?? 0;
      }
    }
  }
  return { runs, last_run_at: last, success_rate: runs ? +(ok / runs).toFixed(3) : null, avg_ms: runs ? Math.round(total / runs) : null };
}

function agentView(st: Store, a: AgentRec, views = allViews(st)): Agent {
  return { ...clone(a), stats: agentStats(views, a.id) };
}

function pipelineView(st: Store, p: PipelineRec, views = allViews(st)): Pipeline {
  const mine = views.filter((v) => v.pipeline_id === p.id);
  const last = mine[0] ?? null;
  const now = Date.now();
  let next: string | null = null;
  if (p.enabled && p.trigger.type === "schedule" && p.trigger.every_minutes) {
    const every = p.trigger.every_minutes * 60_000;
    const base = last ? ms(last.created_at) : ms(p.created_at);
    const k = Math.max(1, Math.ceil((now - base) / every));
    next = iso(base + k * every);
  }
  const steps: PipelineStep[] = p.steps.map((s) => {
    const a = agentOf(st, s.agent_id);
    return { id: s.id, agent_id: s.agent_id, agent_name: a?.name ?? "Deleted agent", kind: a?.kind, ...(s.overrides ? { overrides: clone(s.overrides) } : {}) };
  });
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    steps,
    trigger: {
      type: p.trigger.type,
      every_minutes: p.trigger.type === "schedule" ? p.trigger.every_minutes : null,
      webhook_url: p.trigger.type === "webhook" && p.webhook_token ? `${HOOK_BASE}/${p.id}?token=${p.webhook_token}` : null,
    },
    require_approval: p.require_approval,
    enabled: p.enabled,
    next_run_at: next,
    last_run: last ? summary(last) : null,
    runs_7d: mine.filter((v) => ms(v.created_at) >= now - 7 * 86_400_000).length,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function datasetView(st: Store, d: DatasetRec): Dataset {
  const { template: _t, ...rest } = d;
  void _t;
  return { ...clone(rest), record_count: (st.records[d.id] ?? []).length };
}

function connectionView(c: ConnRec): Connection {
  const { secrets, ...rest } = c;
  return { ...clone(rest), secrets_set: Object.keys(secrets).filter((k) => !!secrets[k]) };
}

function wsStats(st: Store, views = allViews(st)): WorkspaceStats {
  const now = Date.now();
  const d1 = now - 86_400_000;
  const d7 = now - 7 * 86_400_000;
  return {
    agents: st.agents.length,
    pipelines: st.pipelines.length,
    runs_24h: views.filter((v) => ms(v.created_at) >= d1).length,
    failed_24h: views.filter((v) => ms(v.created_at) >= d1 && v.status === "failed").length,
    content_7d: st.content.filter((c) => ms(c.created_at) >= d7).length,
    published_7d: st.content.filter((c) => c.published_at && ms(c.published_at) >= d7).length,
    records: st.datasets.reduce((n, d) => n + (st.records[d.id] ?? []).length, 0),
  };
}

function wsView(w: WsBase): Workspace {
  const st = storeFor(w.slug);
  tickStore(st);
  return {
    id: w.id,
    slug: w.slug,
    name: w.name,
    industry: w.industry,
    brand_color: w.brand_color,
    domain: w.domain,
    timezone: w.timezone,
    modules: [...w.modules],
    blueprint: w.blueprint,
    created_at: w.created_at,
    stats: wsStats(st),
  };
}

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function runsByDay(st: Store, views = allViews(st)): { day: string; succeeded: number; failed: number }[] {
  const rng = seeded(`runs-by-day:${st.slug}:${dayKey(new Date())}`);
  let rate = 0;
  for (const p of st.pipelines) {
    if (!p.enabled) continue;
    rate += p.trigger.type === "schedule" && p.trigger.every_minutes ? Math.min(1440 / p.trigger.every_minutes, 8) : 0.5;
  }
  const today = new Date();
  const createdMs = ms(wsBase(st.slug)?.created_at ?? null);
  const days: { day: string; succeeded: number; failed: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dayKey(d);
    let succeeded = 0;
    let failed = 0;
    // synthetic history only for days the workspace already existed
    if (i >= 2 && rate > 0 && d.getTime() >= createdMs) {
      succeeded = Math.max(0, Math.round(rate * (0.6 + rng() * 0.8)));
      failed = rng() < 0.12 + Math.min(0.2, rate / 60) ? 1 : 0;
    } else rng();
    for (const v of views) {
      if (dayKey(new Date(v.created_at)) !== key) continue;
      if (v.status === "failed") failed++;
      else if (v.status === "succeeded") succeeded++;
    }
    days.push({ day: key, succeeded, failed });
  }
  return days;
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).replace(/[\s,;:.]+$/, "")}…`;
}

function activity(st: Store, views = allViews(st)): ActivityEvent[] {
  const ws = wsBase(st.slug);
  const name = ws?.name ?? st.slug;
  const ev: ActivityEvent[] = [...st.events];
  for (const v of views) {
    const base = { workspace: st.slug, workspace_name: name };
    if (v.status === "succeeded") {
      ev.push({ ...base, id: `ev_${v.id}`, at: v.finished_at ?? v.created_at, kind: "run", status: "ok", message: `${v.pipeline_name} finished · ${v.items_out} item${v.items_out === 1 ? "" : "s"} out${v.content_created ? ` · ${v.content_created} content` : ""}` });
    } else if (v.status === "failed") {
      ev.push({ ...base, id: `ev_${v.id}`, at: v.finished_at ?? v.created_at, kind: "error", status: "error", message: `${v.pipeline_name} failed: ${v.error ?? "unknown error"}` });
    } else if (v.status === "awaiting_approval") {
      const at = [...v.steps].reverse().find((s) => s.finished_at)?.finished_at ?? v.created_at;
      ev.push({ ...base, id: `ev_${v.id}`, at, kind: "run", status: "warn", message: `${v.pipeline_name} is waiting for approval (${v.content_created} draft${v.content_created === 1 ? "" : "s"})` });
    } else if (v.status === "cancelled") {
      ev.push({ ...base, id: `ev_${v.id}`, at: v.finished_at ?? v.created_at, kind: "run", status: "warn", message: `${v.pipeline_name} was cancelled` });
    } else {
      ev.push({ ...base, id: `ev_${v.id}`, at: v.created_at, kind: "run", status: "info", message: `${v.pipeline_name} started (${v.trigger})` });
    }
  }
  for (const c of st.content) {
    if (!c.published_at || !c.publications.length) continue;
    const manual = c.publications.filter((p) => p.status === "manual").length;
    const failed = c.publications.filter((p) => p.status === "failed").length;
    const ok = c.publications.length - manual - failed;
    ev.push({
      id: `ev_pub_${c.id}`,
      at: c.published_at,
      workspace: st.slug,
      workspace_name: name,
      kind: "publish",
      status: failed ? "warn" : "ok",
      message: `Published “${clip(c.title, 64)}” to ${ok} channel${ok === 1 ? "" : "s"}${manual ? ` · ${manual} ready for manual posting` : ""}${failed ? ` · ${failed} failed` : ""}`,
    });
  }
  return ev.sort((a, b) => ms(b.at) - ms(a.at));
}

/* ====================================================================================== */
/* Validation helpers                                                                     */
/* ====================================================================================== */

interface FilterSpec {
  field: string;
  op: string;
  value?: unknown;
}

function parseFilters(v: unknown): FilterSpec[] {
  let arr: unknown = v;
  if (typeof v === "string") {
    if (!v.trim()) return [];
    try {
      arr = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(arr) ? (arr.filter((x) => x && typeof x === "object" && "field" in x && "op" in x) as FilterSpec[]) : [];
}

const FILTER_OPS = ["eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte", "exists", "date_after_today", "date_within_days"];

function validateConfig(kind: AgentKind, config: Record<string, unknown>): Record<string, unknown> {
  const out = { ...config };
  for (const f of agentType(kind)?.config_schema ?? []) {
    if (!(f.key in out)) continue;
    const v = out[f.key];
    switch (f.type) {
      case "number": {
        if (v === null || v === "") {
          out[f.key] = f.default ?? null;
          break;
        }
        const n = Number(v);
        if (!Number.isFinite(n)) bad(`${f.label} must be a number`, "invalid_config");
        if (f.min !== undefined && n < f.min) bad(`${f.label} must be at least ${f.min}`, "invalid_config");
        if (f.max !== undefined && n > f.max) bad(`${f.label} must be at most ${f.max}`, "invalid_config");
        out[f.key] = n;
        break;
      }
      case "boolean":
        out[f.key] = v === true || v === "true";
        break;
      case "select":
        if (v !== null && v !== "" && f.options && !f.options.some((o) => o.value === v)) bad(`${f.label}: “${String(v)}” is not one of ${f.options.map((o) => o.value).join(", ")}`, "invalid_config");
        break;
      case "multiselect":
      case "formats": {
        const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
        const allowed = f.type === "formats" ? (ALL_FORMATS as string[]) : (f.options ?? []).map((o) => o.value);
        const badOne = arr.find((x) => !allowed.includes(String(x)));
        if (badOne !== undefined) bad(`${f.label}: “${String(badOne)}” is not allowed`, "invalid_config");
        out[f.key] = arr;
        break;
      }
      case "string_list":
        out[f.key] = Array.isArray(v) ? v.map(String).filter((s) => s.trim()) : typeof v === "string" ? v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : [];
        break;
      case "sources":
      case "extract_fields":
      case "connections":
        if (!Array.isArray(v)) bad(`${f.label} must be a list`, "invalid_config");
        break;
      case "textarea":
        if (kind === "data_transform" && f.key === "filters") {
          let arr: unknown = v;
          if (typeof v === "string") {
            if (!v.trim()) arr = [];
            else {
              try {
                arr = JSON.parse(v);
              } catch {
                bad("Filters must be valid JSON: a list of {field, op, value}", "invalid_config");
              }
            }
          }
          if (!Array.isArray(arr)) bad("Filters must be a JSON list of {field, op, value}", "invalid_config");
          const bo = (arr as FilterSpec[]).find((x) => !x || typeof x !== "object" || !x.field || !FILTER_OPS.includes(String(x.op)));
          if (bo) bad(`Invalid filter ${JSON.stringify(bo)}: ops are ${FILTER_OPS.join("|")}`, "invalid_config");
          out[f.key] = arr;
        }
        break;
      default:
        break;
    }
  }
  return out;
}

function requireName(v: unknown, what: string): string {
  if (typeof v !== "string" || !v.trim()) bad(`${what} is required`);
  return v.trim();
}

/* ====================================================================================== */
/* Blueprints                                                                             */
/* ====================================================================================== */

function applyBlueprint(st: Store, key: string): { agents: Agent[]; pipelines: Pipeline[]; datasets: Dataset[] } {
  const bp = BLUEPRINTS.find((b) => b.key === key);
  if (!bp) notFound("Blueprint");
  const spec = BLUEPRINT_SPECS[key] ?? { configs: {}, datasets: {}, approval: [] };
  const now = new Date().toISOString();
  const datasets: DatasetRec[] = [];
  for (const name of bp.datasets) {
    const tpl = DATASET_TEMPLATES[spec.datasets[name] ?? ""];
    const slug = uniqueSlug(slugify(tpl?.slug ?? name), (s) => st.datasets.some((d) => d.slug === s));
    const d: DatasetRec = {
      id: uid("ds_"),
      name,
      slug,
      description: tpl?.description.replace(/ (Sample data for demo purposes|Fictional (events|companies) for demo purposes)[^.]*\./, "") ?? "",
      key_field: tpl?.key_field ?? "name",
      fields: clone(tpl?.fields ?? [{ key: "name", label: "Name", type: "text" }]),
      public: tpl?.public ?? false,
      updated_at: now,
      created_at: now,
      template: tpl?.key ?? null,
    };
    st.datasets.push(d);
    st.records[d.id] = [];
    datasets.push(d);
  }
  const firstDs = datasets[0]?.id ?? st.datasets[0]?.id ?? "";
  const connected = st.connections.filter((c) => c.status === "connected").map((c) => c.id);
  const byName = new Map<string, string>();
  const agents: AgentRec[] = bp.agents.map((ba) => {
    const extra = clone(spec.configs[ba.name] ?? {});
    for (const [k, v] of Object.entries(extra)) if (v === "$dataset") extra[k] = firstDs;
    const config = { ...configDefaults(ba.kind), ...extra };
    if (ba.kind === "auto_publisher" && !extra.connections) config.connections = connected;
    const a: AgentRec = { id: uid("agt_"), name: ba.name, kind: ba.kind, description: ba.description, config, model: modelOf(ba.kind, config), enabled: true, created_at: now, updated_at: now };
    byName.set(ba.name, a.id);
    st.agents.push(a);
    return a;
  });
  const pipelines: PipelineRec[] = bp.pipelines.map((bpp) => {
    const trig = parseBlueprintTrigger(bpp.trigger);
    const p: PipelineRec = {
      id: uid("pip_"),
      name: bpp.name,
      description: `${bp.name}: ${bpp.steps.join(" → ")}`,
      steps: bpp.steps.map((n) => byName.get(n)).filter((x): x is string => !!x).map((agent_id) => ({ id: randHex(12), agent_id })),
      trigger: trig,
      webhook_token: trig.type === "webhook" ? `whk_${randHex(24)}` : null,
      require_approval: spec.approval.includes(bpp.name),
      enabled: true,
      created_at: now,
      updated_at: now,
    };
    st.pipelines.push(p);
    return p;
  });
  addEvent(st, "agent", `Applied the ${bp.name} blueprint: ${agents.length} agents, ${pipelines.length} pipeline${pipelines.length === 1 ? "" : "s"}${datasets.length ? `, ${datasets.length} dataset${datasets.length === 1 ? "" : "s"}` : ""}`, "ok");
  const views = allViews(st);
  return { agents: agents.map((a) => agentView(st, a, views)), pipelines: pipelines.map((p) => pipelineView(st, p, views)), datasets: datasets.map((d) => datasetView(st, d)) };
}

/* ====================================================================================== */
/* Agent test                                                                             */
/* ====================================================================================== */

function flow(p: Partial<FlowItem> & { title: string }): FlowItem {
  return {
    id: uid("itm_"),
    title: p.title,
    url: p.url ?? null,
    text: p.text ?? "",
    summary: p.summary ?? null,
    source_name: p.source_name ?? null,
    published_at: p.published_at ?? null,
    image_url: p.image_url ?? null,
    data: p.data ?? {},
    formats: p.formats ?? {},
    flags: p.flags ?? [],
  };
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"‘'₹])/)
    .filter(Boolean);
}

function topicFromText(text: string, ws: WsBase): TopicSpec {
  const ss = sentences(text);
  const pool = TOPIC_POOLS[ws.slug] ?? TOPIC_POOLS[ws.industry] ?? TOPIC_POOLS.other;
  const fallback = TOPICS[pool[0]];
  if (ss.length === 0) return fallback;
  const title = clip(ss[0].replace(/[.!?]$/, ""), 100);
  const numbers = ss.filter((s) => /\d/.test(s)).slice(0, 4);
  const chunks: [string, string][] = [];
  const rest = ss.slice(1);
  const heads = ["What happened", "Why it matters", "What to watch"];
  for (let i = 0; i < 3 && rest.length; i++) chunks.push([heads[i], rest.splice(0, Math.max(1, Math.ceil(ss.length / 3))).join(" ")]);
  const words = [...new Set((text.match(/\b[A-Z][a-zA-Z]{3,}\b/g) ?? []).slice(0, 3))];
  return {
    key: "custom",
    title,
    summary: clip(ss.slice(0, 2).join(" "), 220),
    tags: words.map((w) => w.toLowerCase()),
    source_name: "Test input",
    source_url: "https://example.com/source",
    hook: clip(ss[0], 200),
    intro: ss.slice(0, 2).join(" "),
    sections: chunks.length ? chunks : [["What happened", ss[0]]],
    numbers: numbers.length ? numbers.map((n) => clip(n, 120)) : ss.slice(0, 3).map((n) => clip(n, 120)),
    takeaway: ss[ss.length - 1],
    question: "What's your take?",
    hashtags: words.length ? words : ["News"],
  };
}

function sampleItemsForFields(fields: { key: string; type?: string }[], st: Store, url: string | null): FlowItem[] {
  const keys = new Set(fields.map((f) => f.key));
  const tpl = Object.values(DATASET_TEMPLATES).find((t) => t.fields.filter((f) => keys.has(f.key)).length >= Math.min(3, keys.size));
  if (tpl && keys.size) {
    return tpl
      .rows()
      .slice(0, 3)
      .map((row) => {
        const data = Object.fromEntries([...keys].map((k) => [k, row[k] ?? null]));
        const title = String(row[tpl.key_field] ?? "Item");
        return flow({ title, url: url ?? tpl.source(row), text: `${title}: ${Object.entries(data).filter(([k]) => k !== tpl.key_field).slice(0, 4).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(", ") : v}`).join("; ")}`, source_name: host(url ?? tpl.source(row) ?? ""), data });
      });
  }
  void st;
  const h = host(url ?? "https://example.com");
  return [1, 2, 3].map((i) =>
    flow({
      title: `${h}: listing ${i}`,
      url: url ? `${url.replace(/\/$/, "")}/item-${i}` : `https://${h}/item-${i}`,
      text: `Sample content extracted from ${h}, item ${i}.`,
      source_name: h,
      data: Object.fromEntries(fields.map((f) => [f.key, f.type === "number" || f.type === "currency" ? i * 100 : f.type === "date" ? new Date(Date.now() + i * 7 * 86_400_000).toISOString().slice(0, 10) : f.type === "list" ? ["sample"] : `${f.key} ${i}`])),
    }),
  );
}

function applyTransform(items: FlowItem[], cfg: Record<string, unknown>): { out: FlowItem[]; logs: string[] } {
  const logs: string[] = [];
  let cur = [...items];
  const dedupe = Array.isArray(cfg.dedupe_by) ? (cfg.dedupe_by as string[]) : [];
  if (dedupe.length) {
    const seen = new Set<string>();
    const before = cur.length;
    cur = cur.filter((it) => {
      const keys = dedupe.map((k) => String(k === "url" ? (it.url ?? it.data.url ?? "") : k === "title" ? it.title : (it.data[k] ?? "")).toLowerCase()).filter(Boolean);
      if (keys.some((k) => seen.has(`${dedupe[keys.indexOf(k)]}:${k}`))) return false;
      keys.forEach((k, i) => seen.add(`${dedupe[i]}:${k}`));
      return true;
    });
    logs.push(`Deduplicated by ${dedupe.join(", ")} · removed ${before - cur.length}`);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const f of parseFilters(cfg.filters)) {
    const before = cur.length;
    cur = cur.filter((it) => {
      const v = f.field === "title" ? it.title : it.data[f.field];
      const n = Number(v);
      const val = f.value;
      switch (f.op) {
        case "eq":
          return String(v).toLowerCase() === String(val).toLowerCase();
        case "neq":
          return String(v).toLowerCase() !== String(val).toLowerCase();
        case "contains":
          return (Array.isArray(v) ? v.join(" ") : String(v ?? "")).toLowerCase().includes(String(val).toLowerCase());
        case "not_contains":
          return !(Array.isArray(v) ? v.join(" ") : String(v ?? "")).toLowerCase().includes(String(val).toLowerCase());
        case "gt":
          return n > Number(val);
        case "gte":
          return n >= Number(val);
        case "lt":
          return n < Number(val);
        case "lte":
          return n <= Number(val);
        case "exists":
          return v !== undefined && v !== null && v !== "";
        case "date_after_today": {
          const d = new Date(String(v));
          return !Number.isNaN(d.getTime()) && d >= today;
        }
        case "date_within_days": {
          const d = new Date(String(v));
          return !Number.isNaN(d.getTime()) && d >= today && d.getTime() <= today.getTime() + Number(val ?? 7) * 86_400_000;
        }
        default:
          return true;
      }
    });
    logs.push(`Filter ${f.field} ${f.op}${f.value !== undefined ? ` ${JSON.stringify(f.value)}` : ""} · removed ${before - cur.length}`);
  }
  const sortBy = typeof cfg.sort_by === "string" ? cfg.sort_by : "";
  if (sortBy) {
    const dir = cfg.sort_order === "desc" ? -1 : 1;
    cur.sort((a, b) => {
      const x = a.data[sortBy];
      const y = b.data[sortBy];
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x ?? "").localeCompare(String(y ?? "")) * dir;
    });
  }
  const limit = Number(cfg.limit) || cur.length;
  cur = cur.slice(0, limit);
  if (sortBy) logs.push(`Sorted by ${sortBy} ${cfg.sort_order ?? "asc"} · kept ${cur.length} (limit ${limit})`);
  if (cfg.ai_categorize) {
    const cats = Array.isArray(cfg.categories) ? (cfg.categories as string[]) : [];
    const field = String(cfg.category_field || "category");
    const counts = new Map<string, number>();
    for (const it of cur) {
      const hay = `${it.title} ${JSON.stringify(it.data)}`.toLowerCase();
      const rules: [string, RegExp][] = [
        ["AI/ML", /\b(ai|ml|llm|genai|agents?|machine learning)\b/],
        ["Web3", /\b(web3|blockchain|defi|crypto|zero-knowledge)\b/],
        ["FinTech", /\b(fintech|upi|payments?|bank)/],
        ["HealthTech", /\b(health|medical|diagnostics|med)/],
        ["Climate", /\b(climate|sustainab|green|energy)/],
      ];
      const hit = cats.find((c) => rules.some(([name, re]) => name === c && re.test(hay))) ?? cats.find((c) => /open/i.test(c)) ?? cats[0] ?? "Other";
      it.data[field] = hit;
      counts.set(hit, (counts.get(hit) ?? 0) + 1);
    }
    logs.push(`AI-categorized ${cur.length} items into ${field}: ${[...counts.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }
  return { out: cur, logs };
}

function testAgent(st: Store, ws: WsBase, a: AgentRec, body: AgentTestRequest): AgentTestResult {
  const cfg = validateConfig(a.kind, { ...a.config, ...(body.config_override ?? {}) });
  const text = body.input?.text?.trim() || "";
  const url = body.input?.url?.trim() || null;
  const inItems = (body.input?.items ?? []).map((p, i) => flow({ title: p.title ?? `Item ${i + 1}`, ...p }));
  const type = agentType(a.kind);
  const model = type?.uses_model ? (MODEL_TAGS[a.model] ?? a.model) : null;
  const rng = seeded(`${a.id}:${text}:${url ?? ""}`);
  const logs: string[] = [];
  const warn: string[] = [];
  let items: FlowItem[] = [];
  const pool = TOPIC_POOLS[ws.slug] ?? TOPIC_POOLS[ws.industry] ?? TOPIC_POOLS.other;
  const sampleTopic = TOPICS[pool[0]];
  const sourceText = text || inItems[0]?.text || sampleTopic.intro;

  switch (a.kind) {
    case "web_scraper": {
      const srcs = Array.isArray(cfg.sources) ? (cfg.sources as { url?: string }[]) : [];
      const target = url ?? srcs[0]?.url ?? null;
      const fields = Array.isArray(cfg.extract_fields) ? (cfg.extract_fields as { key: string; type?: string }[]) : [];
      logs.push(`Fetching ${target ?? "configured sources"}`);
      items = sampleItemsForFields(fields.length ? fields : [{ key: "title" }, { key: "date", type: "date" }], st, target);
      logs.push(`Found ${items.length + 4} candidate blocks · ${items.length} looked like listings`);
      logs.push(cfg.extraction === "css" ? `Extracted ${fields.length} fields with CSS selectors` : `Extracted ${fields.length || 2} fields per item with ${model}`);
      if (text) logs.push("Input text ignored: the scraper reads pages, give it a URL to test a specific page");
      break;
    }
    case "news_monitor": {
      const kw = Array.isArray(cfg.keywords) ? (cfg.keywords as string[]) : [];
      const topics = pool.map((k) => TOPICS[k]).slice(0, 3);
      const wanted = text ? text.toLowerCase() : "";
      items = topics.map((t, i) =>
        flow({ title: t.title, url: t.source_url, text: t.intro, summary: t.summary, source_name: t.source_name, published_at: minutesAgo(25 + i * 47) }),
      );
      if (wanted) items = [flow({ title: clip(text, 100), text, summary: clip(text, 200), source_name: "Test input", published_at: new Date().toISOString() }), ...items.slice(0, 2)];
      logs.push(`Searching ${kw.length ? kw.slice(0, 4).join(", ") : "your keywords"} in the last ${cfg.lookback_hours ?? 24}h`);
      logs.push(`Fetched ${items.length + 9} items · kept ${items.length} after de-duplication`);
      break;
    }
    case "persona_rewriter": {
      const ss = sentences(sourceText);
      const lead: Record<string, string> = { authoritative: "The short version:", analytical: "The number that matters:", conversational: "So, here's the thing:", friendly: "Quick update for you:", punchy: "In short:" };
      const who = personaName(cfg);
      const paras: string[] = [];
      paras.push(`${lead[String(cfg.tone)] ?? "In brief:"} ${ss[0] ?? sourceText}`);
      for (let i = 1; i < ss.length - 1; i += 2) paras.push(ss.slice(i, i + 2).join(" "));
      if (ss.length > 1) paras.push(`**Why it matters:** ${ss[ss.length - 1]}`);
      if (who) paras.push(`— ${who}`);
      const banned = (Array.isArray(cfg.banned_phrases) ? (cfg.banned_phrases as string[]) : []).filter((p) => sourceText.toLowerCase().includes(p.toLowerCase()));
      items = [flow({ title: clip((ss[0] ?? "Rewritten item").replace(/[.!?]$/, ""), 100), text: paras.join("\n\n"), summary: clip(ss.slice(0, 2).join(" "), 200), source_name: inItems[0]?.source_name ?? "Test input" })];
      logs.push(`Rewriting 1 item with ${model} (${cfg.tone ?? "analytical"}, ${cfg.length ?? "medium"})`);
      if (banned.length) warn.push(`Removed banned phrase${banned.length > 1 ? "s" : ""}: ${banned.join(", ")}`);
      logs.push(`Rewrote 1 item in ${who ? `${who}'s` : "the house"} voice · ${paras.join(" ").split(/\s+/).length} words`);
      break;
    }
    case "multi_format": {
      const topic = text || inItems.length ? topicFromText(sourceText, ws) : sampleTopic;
      const formats = (Array.isArray(cfg.formats) ? (cfg.formats as ContentFormat[]) : (["article"] as ContentFormat[])).filter((f) => ALL_FORMATS.includes(f));
      const map: Partial<Record<ContentFormat, string>> = {};
      for (const f of formats) map[f] = buildVariant(topic, f, brand(ws), { maxTags: cfg.hashtags === false ? 0 : Number(cfg.max_hashtags ?? 3) }).body;
      items = [flow({ title: topic.title, text: topic.intro, summary: topic.summary, source_name: topic.source_name, formats: map })];
      logs.push(`Generating ${formats.length} formats with ${model}`);
      logs.push(`Created ${formats.map((f) => `${f} (${map[f]?.length ?? 0} chars)`).join(", ")}`);
      break;
    }
    case "seo_optimizer": {
      const topic = text || inItems.length ? topicFromText(sourceText, ws) : sampleTopic;
      const slug = slugify(topic.title);
      const seo = buildSeo(topic, { ...brand(ws), brand: String(cfg.site_name || ws.name) }, String(cfg.schema_type ?? "Article"), new Date().toISOString(), slug);
      items = [flow({ title: topic.title, text: topic.intro, summary: topic.summary, data: { ...seo, slug } })];
      logs.push(`Title tag: ${seo.title_tag?.length ?? 0} chars · meta description: ${seo.meta_description?.length ?? 0} chars`);
      logs.push(`Added ${cfg.schema_type ?? "Article"} JSON-LD`);
      break;
    }
    case "quality_gate": {
      const words = sourceText.split(/\s+/).filter(Boolean).length;
      const flags: string[] = [];
      const banned = (Array.isArray(cfg.banned_phrases) ? (cfg.banned_phrases as string[]) : []).filter((p) => sourceText.toLowerCase().includes(p.toLowerCase()));
      if (banned.length) flags.push(`Banned phrase: ${banned.join(", ")}`);
      const minWords = Number(cfg.min_words ?? 0);
      if (minWords && words < minWords) flags.push(`Too short: ${words} words (min ${minWords})`);
      const figures = (sourceText.match(/\d[\d,.]*%?/g) ?? []).length;
      if (figures > 0 && rng() < 0.3) flags.push("One figure could not be matched to a source");
      const score = Math.max(20, Math.min(98, 94 - flags.length * 14 - Math.floor(rng() * 6)));
      const passed = score >= Number(cfg.min_score ?? 70);
      items = passed || cfg.on_fail === "flag" ? [flow({ title: clip(sentences(sourceText)[0] ?? "Item", 100), text: sourceText, flags, data: { score, passed } })] : [];
      logs.push(`Checked ${words} words · ${figures} figure${figures === 1 ? "" : "s"} grounded against the source`);
      logs.push(`Score ${score}/100 (min ${cfg.min_score ?? 70}) · ${passed ? "passed" : cfg.on_fail === "flag" ? "flagged for review" : "dropped"}`);
      for (const f of flags) warn.push(f);
      break;
    }
    case "data_transform": {
      let input = inItems;
      if (!input.length) {
        const rows = DATASET_TEMPLATES.hackathons.rows();
        const past = { ...rows[0], name: "Winter of Code Hack", registration_deadline: new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10), url: "https://winterofcode.dev" };
        const past2 = { ...rows[3], name: "DevSprint Delhi", registration_deadline: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10), url: "https://devsprint.in" };
        const all: Record<string, unknown>[] = [...rows, rows[1], rows[0], past, past2];
        input = all.map((r) => flow({ title: String(r.name), url: String(r.url), text: `${r.name} by ${r.organizer}`, data: { ...r } }));
      }
      const res = applyTransform(input, cfg);
      items = res.out;
      logs.push(`Received ${input.length} items${inItems.length ? "" : " (sample hackathon listings)"}`);
      logs.push(...res.logs);
      break;
    }
    case "auto_publisher": {
      const ids = Array.isArray(cfg.connections) ? (cfg.connections as string[]) : [];
      const conns = ids.map((id) => st.connections.find((c) => c.id === id)).filter((c): c is ConnRec => !!c);
      const latest = st.content.find((c) => c.status === "approved") ?? st.content[0];
      const title = text ? clip(text, 100) : (latest?.title ?? sampleTopic.title);
      items = conns.map((c) => {
        const action = c.status !== "connected" ? "skipped: needs setup" : connectionKind(c.kind)?.auto_publish === false ? "prepared for manual posting" : "would publish";
        const fmt = latest ? pickFormat(c.kind, latest) : "article";
        return flow({ title, data: { connection: c.name, kind: c.kind, format: fmt, action } });
      });
      logs.push("Dry run: nothing is sent during a test");
      for (const it of items) logs.push(`${it.data.connection}: ${it.data.action} (${it.data.format})`);
      if (!conns.length) warn.push("No connections selected");
      break;
    }
    case "dataset_builder": {
      const ds = st.datasets.find((d) => d.id === cfg.dataset);
      if (!ds) warn.push("No dataset selected: records are extracted but would not be saved");
      const existing = ds ? (st.records[ds.id] ?? []) : [];
      if (cfg.source_mode === "pipeline_items") {
        const input = inItems.length ? inItems : sampleItemsForFields((ds?.fields ?? [{ key: "name", label: "Name", type: "text" }]).map((f) => ({ key: f.key, type: f.type })), st, null);
        items = input;
        logs.push(`Received ${input.length} items`);
      } else {
        const fields = Array.isArray(cfg.extract_fields) && cfg.extract_fields.length ? (cfg.extract_fields as { key: string; type?: string }[]) : (ds?.fields ?? []).map((f) => ({ key: f.key, type: f.type }));
        const srcs = Array.isArray(cfg.sources) ? (cfg.sources as { url?: string }[]) : [];
        const tpl = templateFor(ds);
        if (tpl && ds) {
          items = tpl.rows().slice(0, 3).map((row) => flow({ title: String(row[tpl.key_field]), url: url ?? tpl.source(row), text: "", data: Object.fromEntries(ds.fields.map((f) => [f.key, row[f.key] ?? null])) }));
        } else items = sampleItemsForFields(fields, st, url ?? srcs[0]?.url ?? null);
        logs.push(`Scraping ${url ?? srcs[0]?.url ?? "configured sources"}`);
        logs.push(`Extracted ${items.length} records with ${model}`);
      }
      const key = String(cfg.key_field || ds?.key_field || "name");
      const updates = items.filter((it) => existing.some((r) => r.key.toLowerCase() === String(it.data[key] ?? it.title).toLowerCase())).length;
      logs.push(`Dry run: would upsert ${items.length} records into ${ds?.name ?? "a dataset"} (${items.length - updates} new, ${updates} updated) · nothing saved`);
      break;
    }
    case "comparison_assistant": {
      const ds = st.datasets.find((d) => d.id === cfg.dataset);
      if (!ds) {
        warn.push("No dataset selected");
        items = [];
        break;
      }
      const suggested = Array.isArray(cfg.suggested_questions) ? (cfg.suggested_questions as string[]) : [];
      const q = text || suggested[0] || "Compare the top two";
      const res = runChat({ dataset: datasetView(st, ds), records: st.records[ds.id] ?? [], message: q, maxRecords: Number(cfg.max_records ?? 4) });
      items = [flow({ title: q, text: res.answer, data: { table: res.table, records: res.records.map((r) => r.key), suggestions: res.suggestions } })];
      logs.push(`Retrieved ${res.records.length} record${res.records.length === 1 ? "" : "s"} from ${ds.name}`);
      logs.push(`Answered with ${model}${res.table ? ` · comparison table with ${res.table.rows.length} rows` : ""}`);
      break;
    }
    case "image_finder": {
      const srcs = Array.isArray(cfg.sources) ? (cfg.sources as { url?: string }[]) : [];
      const base = inItems.length
        ? inItems.slice(0, 3)
        : st.content.slice(0, 3).map((c) => flow({ title: c.title, url: c.source_url, source_name: c.source_name }));
      const input = base.length ? base : [flow({ title: url ? host(url) : sampleTopic.title, url: url ?? srcs[0]?.url ?? sampleTopic.source_url, source_name: sampleTopic.source_name })];
      items = input.map((it, i) => {
        const images = demoImages(`${a.id}:${it.title}:${i}`, themeFor(ws.industry, it.title), { pageUrl: it.url, sourceName: it.source_name, title: it.title });
        return { ...it, image_url: images[0]?.url ?? null, data: { ...it.data, images } };
      });
      const total = items.reduce((n, it) => n + ((it.data.images as unknown[]) ?? []).length, 0);
      const open = items.reduce((n, it) => n + ((it.data.images as { open_license: boolean }[]) ?? []).filter((m) => m.open_license).length, 0);
      logs.push(`Looked for images for ${items.length} item${items.length === 1 ? "" : "s"}${cfg.search_open_libraries === false ? "" : " (Openverse and Wikimedia Commons first)"}`);
      logs.push(`Found ${total} images ≥ ${cfg.min_width ?? 1000}px · ${open} with an open licence · duplicates removed by image hash`);
      if (cfg.write_alt_text) logs.push("Wrote alt text for every image");
      if (total > open) warn.push(`${total - open} image${total - open === 1 ? " has" : "s have"} an unknown licence: check the rights before publishing`);
      break;
    }
    case "link_collector": {
      const starts = Array.isArray(cfg.start_urls) ? (cfg.start_urls as string[]) : [];
      const start = (url ?? starts[0] ?? `https://${ws.domain ?? "example.com"}/`).replace(/\/$/, "");
      const pats = Array.isArray(cfg.include_patterns) && (cfg.include_patterns as string[]).length ? (cfg.include_patterns as string[]) : ["/"];
      const slugs = ["redmi-note-14-pro", "galaxy-a56-5g", "iphone-16-128gb", "oneplus-nord-5", "pixel-9a", "moto-edge-60"];
      items = slugs.map((sl) => {
        const link = `${start}${pats[0].startsWith("/") ? pats[0].replace(/\/$/, "") : ""}/${sl}`;
        return flow({ title: sl.replace(/-/g, " "), url: link, source_name: host(start), data: { url: link, found_on: start, depth: 1 } });
      });
      logs.push(`Read ${start}${cfg.use_sitemap === false ? "" : " and its sitemap.xml"}`);
      logs.push(`Collected 312 links · kept 128 matching ${pats.join(", ")} · showing the first ${items.length}`);
      logs.push("Removed 41 duplicates and utm_/ref tracking parameters");
      break;
    }
    case "document_reader": {
      const srcs = Array.isArray(cfg.sources) ? (cfg.sources as { url?: string }[]) : [];
      const doc = url ?? srcs[0]?.url ?? `https://${ws.domain ?? "example.edu.in"}/docs/fees-2026.pdf`;
      const name = doc.split("/").pop() || doc;
      const fields = Array.isArray(cfg.extract_fields) ? (cfg.extract_fields as { key: string; label?: string }[]) : [];
      const data: Record<string, unknown> = { file: name, pages: 14 };
      const sample: Record<string, unknown> = { tuition_fee: 225000, hostel_fee: 98000, total_fees: 323000, last_date: "2026-07-15", academic_year: "2026-27" };
      for (const f of fields.length ? fields : [{ key: "total_fees" }, { key: "last_date" }]) data[f.key] = sample[f.key] ?? `${f.label ?? f.key} (page ${2 + Math.floor(rng() * 10)})`;
      items = [flow({ title: `${name}: fee structure 2026-27`, url: doc, text: "B.Tech first-year fees: tuition ₹2,25,000, hostel and mess ₹98,000. Fees are payable in two instalments; the first is due by 15 July 2026.", summary: "Total first-year fees ₹3,23,000; first instalment due 15 July 2026.", source_name: host(doc), data })];
      logs.push(`Downloaded ${name} (1.8 MB)`);
      logs.push(`Read 14 pages from ${name}`);
      logs.push(`Extracted ${Object.keys(data).length - 2} fields with ${model}`);
      break;
    }
    case "page_watcher": {
      const srcs = Array.isArray(cfg.sources) ? (cfg.sources as { url?: string }[]) : [];
      const pages = (url ? [url] : srcs.map((s) => s.url ?? "").filter(Boolean)).slice(0, 3);
      const list = pages.length ? pages : [`https://${ws.domain ?? "example.com"}/`];
      items = [
        flow({ title: `Price changed on ${host(list[0])}`, url: list[0], text: "Price: ₹54,999 → ₹51,999 (−5.5%)", source_name: host(list[0]), data: { field: cfg.watch_selector || "price", before: "₹54,999", after: "₹51,999", change_percent: -5.5 } }),
      ];
      if (list[1]) items.push(flow({ title: `New notice on ${host(list[1])}`, url: list[1], text: "Added: “Last date for fee payment extended to 30 November”", source_name: host(list[1]), data: { field: "notices", before: null, after: "Last date for fee payment extended to 30 November" } }));
      logs.push(`Checked ${list.length + (list.length < 3 ? 1 : 0)} pages · ${items.length} changed`);
      for (const it of items) logs.push(`${host(it.url)}: ${it.text}`);
      break;
    }
    case "keyword_researcher": {
      const seeds = Array.isArray(cfg.seed_keywords) && (cfg.seed_keywords as string[]).length ? (cfg.seed_keywords as string[]) : [text || "best budget phone"];
      const seed = seeds[0];
      const groups: [string, string[]][] = [
        ["learn", [`what is ${seed}`, `${seed} explained`, `how to choose ${seed}`]],
        ["compare", [`${seed} vs alternatives`, `${seed} comparison 2026`, `top 10 ${seed}`]],
        ["buy", [`${seed} price`, `${seed} offers today`, `cheapest ${seed}`]],
        ["local", [`${seed} near me`, `${seed} in mumbai`]],
      ];
      items = groups.flatMap(([intent, kws]) => kws.map((k, i) => flow({ title: k, data: { keyword: k, intent, seed, popularity: 90 - i * 17 - Math.floor(rng() * 10) } })));
      logs.push(`Expanded ${seeds.length} seed keyword${seeds.length === 1 ? "" : "s"} with free search suggestions (${String(cfg.country ?? "in").toUpperCase()})`);
      logs.push(`142 ideas in 4 intent groups · showing the top ${items.length}`);
      break;
    }
    case "comparer": {
      const fields = Array.isArray(cfg.compare_fields) && (cfg.compare_fields as string[]).length ? (cfg.compare_fields as string[]) : ["price", "rating"];
      const lower = new Set(Array.isArray(cfg.lower_is_better) ? (cfg.lower_is_better as string[]) : ["price"]);
      const shops = ["Amazon", "Flipkart", "Croma"];
      const products = ["Redmi Note 14 Pro 5G (8/256)", "Samsung Galaxy A56 5G", "iPhone 16 (128 GB)"];
      items = products.map((p, pi) => {
        const r = seeded(`${a.id}:${p}`);
        const rows = shops.map((shop) => ({ shop, values: Object.fromEntries(fields.map((f) => [f, f === "price" ? [24999, 37999, 69900][pi] - Math.floor(r() * 4) * 500 : f === "rating" ? +(3.9 + r() * 0.9).toFixed(1) : f === "delivery_days" ? 1 + Math.floor(r() * 4) : `${f} ${shop}`])) }));
        const best: Record<string, string> = {};
        for (const f of fields) {
          const nums = rows.filter((x) => typeof x.values[f] === "number");
          if (!nums.length) continue;
          const pick = nums.reduce((m, x) => ((lower.has(f) ? (x.values[f] as number) < (m.values[f] as number) : (x.values[f] as number) > (m.values[f] as number)) ? x : m));
          best[f] = pick.shop;
        }
        return flow({ title: p, text: `${p}: best ${fields[0]} at ${best[fields[0]] ?? shops[0]}`, data: { match_field: cfg.match_field ?? "name", rows, best } });
      });
      logs.push(`Matched ${items.length * 2} products across 3 shops on ${cfg.match_field ?? "name"} (similarity ≥ ${cfg.match_threshold ?? 0.85})`);
      logs.push(`Built ${items.length} comparison tables · best price at ${(items[0].data.best as Record<string, string>).price ?? "Croma"} for ${items[0].title}`);
      break;
    }
    case "custom_llm":
    default: {
      const outFields = Array.isArray(cfg.output_fields) ? (cfg.output_fields as { key: string; label?: string; type?: string }[]) : [];
      const ss = sentences(sourceText);
      const data: Record<string, unknown> = {};
      for (const f of outFields) data[f.key] = f.type === "number" ? Math.round(rng() * 100) : f.type === "list" ? ss.slice(0, 3).map((s) => clip(s, 60)) : clip(ss[0] ?? sourceText, 120);
      items = [flow({ title: clip(ss[0] ?? "Output", 100), text: ss.slice(0, 3).map((s) => `• ${s}`).join("\n"), data })];
      logs.push(`Ran prompt with ${model} (temperature ${cfg.temperature ?? 0.4})`);
      logs.push(`Filled ${outFields.length} output field${outFields.length === 1 ? "" : "s"}`);
      break;
    }
  }

  const durations: Partial<Record<AgentKind, number>> = { web_scraper: 2400, news_monitor: 1100, persona_rewriter: 6200, multi_format: 9800, seo_optimizer: 1800, quality_gate: 2100, data_transform: 600, auto_publisher: 400, dataset_builder: 3100, comparison_assistant: 1200, custom_llm: 4200 };
  const duration = Math.round((durations[a.kind] ?? 1500) * (0.8 + rng() * 0.4));
  const start = Date.now() - duration;
  const all: RunLog[] = [
    ...logs.map((m, i) => ({ at: iso(start + ((i + 1) * duration) / (logs.length + warn.length + 1)), level: "info" as const, message: m })),
    ...warn.map((m, i) => ({ at: iso(start + ((logs.length + i + 1) * duration) / (logs.length + warn.length + 1)), level: "warn" as const, message: m })),
  ];
  return { ok: true, duration_ms: duration, items, logs: all, error: null, model };
}

/* ====================================================================================== */
/* Records                                                                                */
/* ====================================================================================== */

function coerce(field: DatasetField | undefined, v: unknown): unknown {
  if (!field || v === null || v === undefined) return v ?? null;
  switch (field.type) {
    case "number":
    case "currency":
    case "rating": {
      if (typeof v === "number") return v;
      const s = String(v).replace(/[₹,\s]|LPA|%/gi, "");
      if (s === "") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : v;
    }
    case "boolean":
      return typeof v === "boolean" ? v : /^(true|yes|1|y)$/i.test(String(v));
    case "list":
      return Array.isArray(v) ? v : String(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    default:
      return typeof v === "string" ? v : String(v);
  }
}

function coerceRow(ds: DatasetRec, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = coerce(ds.fields.find((f) => f.key === k), v);
  return out;
}

function upsertRecord(st: Store, ds: DatasetRec, data: Record<string, unknown>, sourceUrl: string | null): { rec: DatasetRecord; created: boolean } {
  const row = coerceRow(ds, data);
  const keyVal = row[ds.key_field];
  if (keyVal === undefined || keyVal === null || String(keyVal).trim() === "") bad(`“${ds.key_field}” (the key field) is required`);
  const key = String(keyVal).trim();
  const list = (st.records[ds.id] ??= []);
  const now = new Date().toISOString();
  const existing = list.find((r) => r.key.toLowerCase() === key.toLowerCase());
  ds.updated_at = now;
  if (existing) {
    existing.data = { ...existing.data, ...row };
    if (sourceUrl) existing.source_url = sourceUrl;
    existing.updated_at = now;
    return { rec: existing, created: false };
  }
  const rec: DatasetRecord = { id: uid("rec_"), dataset_id: ds.id, key, data: row, source_url: sourceUrl, created_at: now, updated_at: now };
  list.push(rec);
  return { rec, created: true };
}

function findDataset(st: Store, idOrSlug: string): DatasetRec {
  const d = st.datasets.find((x) => x.id === idOrSlug || x.slug === idOrSlug);
  if (!d) notFound("Dataset");
  return d;
}

function validateFields(fields: unknown, keyField: unknown): { fields: DatasetField[]; key_field: string } {
  if (!Array.isArray(fields) || fields.length === 0) bad("A dataset needs at least one field");
  const types = ["text", "number", "currency", "url", "list", "rating", "boolean", "date"];
  const out: DatasetField[] = (fields as DatasetField[]).map((f) => {
    if (!f || typeof f.key !== "string" || !/^[a-z][a-z0-9_]*$/.test(f.key)) bad(`Invalid field key “${String(f?.key)}”: use lower_snake_case`);
    if (!types.includes(f.type)) bad(`Field ${f.key}: type must be one of ${types.join(", ")}`);
    return { key: f.key, label: f.label || f.key, type: f.type, ...(f.compare !== undefined ? { compare: !!f.compare } : {}), ...(f.unit ? { unit: f.unit } : {}), ...(f.higher_is_better !== undefined ? { higher_is_better: !!f.higher_is_better } : {}) };
  });
  const keys = out.map((f) => f.key);
  if (new Set(keys).size !== keys.length) bad("Field keys must be unique");
  const kf = typeof keyField === "string" && keyField ? keyField : keys[0];
  if (!keys.includes(kf)) bad(`Key field “${kf}” is not one of the fields`);
  return { fields: out, key_field: kf };
}

/* ====================================================================================== */
/* Route handlers                                                                         */
/* ====================================================================================== */

function handleWorkspaces(req: DemoRequest): unknown {
  const [, slug] = req.segments;
  const body = req.body ?? {};
  if (!slug) {
    if (req.method === "GET") return { items: reg().map(wsView) };
    if (req.method === "POST") {
      const name = requireName(body.name, "Name");
      const s = slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : name);
      if (wsBase(s)) throw new DemoError(409, "slug_taken", `A workspace with the slug “${s}” already exists`);
      const color = typeof body.brand_color === "string" && body.brand_color ? body.brand_color : "#475569";
      if (!/^#[0-9a-f]{6}$/i.test(color)) bad("Brand colour must be a hex value like #2563eb");
      const bpKey = typeof body.blueprint === "string" && body.blueprint ? body.blueprint : null;
      const bp = bpKey ? BLUEPRINTS.find((b) => b.key === bpKey) : null;
      if (bpKey && !bp) bad(`Unknown blueprint “${bpKey}”`);
      const industry = typeof body.industry === "string" && body.industry ? body.industry : (bp?.industry ?? "other");
      const w: WsBase = {
        id: uid("ws_"),
        slug: s,
        name,
        industry,
        brand_color: color,
        domain: typeof body.domain === "string" && body.domain.trim() ? body.domain.trim().replace(/^https?:\/\//, "").replace(/\/$/, "") : null,
        timezone: typeof body.timezone === "string" && body.timezone ? body.timezone : "Asia/Kolkata",
        modules: bp ? [...bp.modules] : ["pipelines"],
        blueprint: bp?.key ?? null,
        created_at: new Date().toISOString(),
        persona: `${name} editorial team`,
        path_prefix: "/posts",
      };
      reg().push(w);
      const st = emptyStore(s);
      stores.set(s, st);
      addEvent(st, "agent", `Workspace ${name} created${bp ? ` from the ${bp.name} blueprint` : ""}`, "ok");
      if (bp) applyBlueprint(st, bp.key);
      return wsView(w);
    }
    return UNHANDLED;
  }
  if (req.segments.length !== 2) return UNHANDLED;
  const w = wsBase(slug);
  if (!w) notFound("Workspace");
  if (req.method === "GET") return wsView(w);
  if (req.method === "PATCH") {
    if (body.name !== undefined) w.name = requireName(body.name, "Name");
    if (body.industry !== undefined) w.industry = String(body.industry || "other");
    if (body.brand_color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(String(body.brand_color))) bad("Brand colour must be a hex value like #2563eb");
      w.brand_color = String(body.brand_color);
    }
    if (body.domain !== undefined) w.domain = body.domain ? String(body.domain).replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
    if (body.timezone !== undefined) w.timezone = String(body.timezone || "UTC");
    if (body.modules !== undefined) {
      if (!Array.isArray(body.modules)) bad("Modules must be a list");
      const badMod = (body.modules as unknown[]).find((m) => !MODULES.includes(m as Module));
      if (badMod !== undefined) bad(`Unknown module “${String(badMod)}”`);
      w.modules = [...new Set(body.modules as Module[])];
    }
    return wsView(w);
  }
  if (req.method === "DELETE") {
    if (body.confirm !== slug) throw new DemoError(422, "confirmation_required", `Type the workspace slug “${slug}” to confirm`);
    if (slug === DEMO_DEFAULT_WORKSPACE) throw new DemoError(409, "home_workspace", "The home workspace cannot be deleted");
    registry = reg().filter((x) => x.slug !== slug);
    stores.delete(slug);
    return undefined;
  }
  return UNHANDLED;
}

function handleAgents(req: DemoRequest, st: Store, ws: WsBase): unknown {
  const [, id, action] = req.segments;
  const body = req.body ?? {};
  if (!id) {
    if (req.method === "GET") {
      const views = allViews(st);
      return { items: st.agents.map((a) => agentView(st, a, views)) };
    }
    if (req.method === "POST") {
      const name = requireName(body.name, "Name");
      const kind = body.kind as AgentKind;
      if (!agentType(kind)) bad(`Unknown agent kind “${String(body.kind)}”`, "invalid_kind");
      const config = validateConfig(kind, { ...configDefaults(kind), ...(body.config ?? {}) });
      const model = modelOf(kind, config, body.model);
      if (agentType(kind)?.config_schema.some((f) => f.key === "model")) config.model = model;
      const now = new Date().toISOString();
      const a: AgentRec = { id: uid("agt_"), name, kind, description: typeof body.description === "string" ? body.description : "", config, model, enabled: body.enabled !== false, created_at: now, updated_at: now };
      st.agents.push(a);
      addEvent(st, "agent", `Agent ${name} created (${agentType(kind)?.name ?? kind})`, "ok");
      return agentView(st, a);
    }
    return UNHANDLED;
  }
  const a = agentOf(st, id);
  if (!a) notFound("Agent");
  if (action === "test" && req.method === "POST") return testAgent(st, ws, a, body as AgentTestRequest);
  if (action) return UNHANDLED;
  if (req.method === "GET") return agentView(st, a);
  if (req.method === "PATCH") {
    if (body.name !== undefined) a.name = requireName(body.name, "Name");
    if (body.description !== undefined) a.description = String(body.description ?? "");
    if (body.enabled !== undefined) a.enabled = !!body.enabled;
    if (body.config !== undefined) {
      if (!body.config || typeof body.config !== "object") bad("Config must be an object");
      a.config = validateConfig(a.kind, { ...a.config, ...body.config });
      if (typeof body.config.model === "string" && body.config.model && body.model === undefined) a.model = body.config.model;
    }
    if (typeof body.model === "string" && body.model) {
      a.model = body.model;
      if ("model" in a.config) a.config.model = body.model;
    }
    a.updated_at = new Date().toISOString();
    addEvent(st, "agent", `Agent ${a.name} updated`, "info");
    return agentView(st, a);
  }
  if (req.method === "DELETE") {
    const using = st.pipelines.find((p) => p.steps.some((s) => s.agent_id === a.id));
    if (using) throw new DemoError(409, "agent_in_use", `${a.name} is used by the pipeline “${using.name}”. Remove it from the pipeline first.`);
    st.agents = st.agents.filter((x) => x.id !== a.id);
    addEvent(st, "agent", `Agent ${a.name} deleted`, "info");
    return undefined;
  }
  return UNHANDLED;
}

function pipelineFromBody(st: Store, body: Record<string, unknown>, existing?: PipelineRec): Pick<PipelineRec, "steps" | "trigger"> {
  let steps = existing?.steps ?? [];
  if (body.steps !== undefined || !existing) {
    if (!Array.isArray(body.steps) || body.steps.length === 0) bad("A pipeline needs at least one step");
    steps = (body.steps as { id?: string; agent_id?: string; overrides?: Record<string, unknown> }[]).map((s, i) => {
      if (!s || typeof s.agent_id !== "string" || !agentOf(st, s.agent_id)) bad(`Step ${i + 1}: unknown agent`);
      return { id: s.id || randHex(12), agent_id: s.agent_id, ...(s.overrides && Object.keys(s.overrides).length ? { overrides: clone(s.overrides) } : {}) };
    });
  }
  let trigger = existing?.trigger ?? { type: "manual" as const, every_minutes: null };
  if (body.trigger !== undefined) {
    const t = body.trigger as { type?: string; every_minutes?: number | null };
    if (!t || !["manual", "schedule", "webhook"].includes(String(t.type))) bad("Trigger type must be manual, schedule or webhook");
    const type = t.type as "manual" | "schedule" | "webhook";
    let every: number | null = null;
    if (type === "schedule") {
      every = Number(t.every_minutes ?? 60);
      if (!Number.isFinite(every) || every < 5) bad("Schedules run at most every 5 minutes");
    }
    trigger = { type, every_minutes: every };
  }
  return { steps, trigger };
}

function handlePipelines(req: DemoRequest, st: Store, ws: WsBase): unknown {
  const [, id, action] = req.segments;
  const body = req.body ?? {};
  if (!id) {
    if (req.method === "GET") {
      const views = allViews(st);
      return { items: st.pipelines.map((p) => pipelineView(st, p, views)) };
    }
    if (req.method === "POST") {
      const name = requireName(body.name, "Name");
      const { steps, trigger } = pipelineFromBody(st, body);
      const now = new Date().toISOString();
      const p: PipelineRec = {
        id: uid("pip_"),
        name,
        description: typeof body.description === "string" ? body.description : "",
        steps,
        trigger,
        webhook_token: trigger.type === "webhook" ? `whk_${randHex(24)}` : null,
        require_approval: !!body.require_approval,
        enabled: body.enabled !== false,
        created_at: now,
        updated_at: now,
      };
      st.pipelines.push(p);
      addEvent(st, "agent", `Pipeline ${name} created with ${steps.length} step${steps.length === 1 ? "" : "s"}`, "ok");
      return pipelineView(st, p);
    }
    return UNHANDLED;
  }
  const p = st.pipelines.find((x) => x.id === id);
  if (!p) notFound("Pipeline");
  if (action === "run" && req.method === "POST") {
    if (!p.steps.length) bad("This pipeline has no steps");
    const trig = ["manual", "schedule", "webhook"].includes(body.trigger) ? body.trigger : "manual";
    const run = createRun(st, ws, p, trig, { rng: Math.random, scale: 1 });
    st.runs.push(run);
    return computeRun(run, Date.now());
  }
  if (action) return UNHANDLED;
  if (req.method === "GET") return pipelineView(st, p);
  if (req.method === "PATCH") {
    if (body.name !== undefined) p.name = requireName(body.name, "Name");
    if (body.description !== undefined) p.description = String(body.description ?? "");
    const { steps, trigger } = pipelineFromBody(st, body, p);
    p.steps = steps;
    p.trigger = trigger;
    if (trigger.type === "webhook" && !p.webhook_token) p.webhook_token = `whk_${randHex(24)}`;
    if (body.require_approval !== undefined) p.require_approval = !!body.require_approval;
    if (body.enabled !== undefined) p.enabled = !!body.enabled;
    p.updated_at = new Date().toISOString();
    return pipelineView(st, p);
  }
  if (req.method === "DELETE") {
    st.pipelines = st.pipelines.filter((x) => x.id !== p.id);
    addEvent(st, "agent", `Pipeline ${p.name} deleted`, "info");
    return undefined;
  }
  return UNHANDLED;
}

function handleRuns(req: DemoRequest, st: Store): unknown {
  const [, id, action] = req.segments;
  if (!id) {
    if (req.method !== "GET") return UNHANDLED;
    let items = allViews(st);
    if (req.query.pipeline_id) items = items.filter((r) => r.pipeline_id === req.query.pipeline_id);
    if (req.query.status) {
      const set = new Set(req.query.status.split(","));
      items = items.filter((r) => set.has(r.status));
    }
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    return { items: clone(items.slice(0, limit)) };
  }
  const run = st.runs.find((r) => r.id === id);
  if (!run) notFound("Run");
  if (!action && req.method === "GET") return clone(runView(run));
  if (action === "cancel" && req.method === "POST") {
    const v = runView(run);
    if (!["queued", "running", "awaiting_approval"].includes(v.status)) throw new DemoError(409, "run_not_active", `This run already ${v.status === "cancelled" ? "was cancelled" : v.status}`);
    run.cancelledAt = Date.now();
    tickStore(st);
    return clone(runView(run));
  }
  return UNHANDLED;
}

function findContent(st: Store, id: string): ContentItem {
  const c = st.content.find((x) => x.id === id || x.slug === id);
  if (!c) notFound("Content");
  return c;
}

function settleRunAfterReview(st: Store, item: ContentItem) {
  const run = item.run_id ? st.runs.find((r) => r.id === item.run_id) : undefined;
  if (!run || run.final) return;
  if (runView(run).status !== "awaiting_approval") return;
  const siblings = run.contentIds.map((id) => st.content.find((c) => c.id === id)).filter((c): c is ContentItem => !!c);
  if (siblings.some((c) => c.status === "approved")) run.resumeAt = Date.now();
  else if (!siblings.some((c) => c.status === "draft")) run.skipAt = Date.now();
}

function handleContent(req: DemoRequest, st: Store): unknown {
  const [, id, action] = req.segments;
  const body = req.body ?? {};
  if (!id) {
    if (req.method !== "GET") return UNHANDLED;
    let items = [...st.content].sort((a, b) => ms(b.created_at) - ms(a.created_at));
    if (req.query.status) {
      const set = new Set(req.query.status.split(","));
      items = items.filter((c) => set.has(c.status));
    }
    if (req.query.pipeline_id) items = items.filter((c) => c.pipeline_id === req.query.pipeline_id);
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      items = items.filter((c) => `${c.title} ${c.summary} ${c.tags.join(" ")}`.toLowerCase().includes(q));
    }
    const page = paginate(items, req.query, 50);
    return clone(page) as Paged<ContentItem>;
  }
  const c = findContent(st, id);
  const now = new Date().toISOString();
  if (!action) {
    if (req.method === "GET") return clone(c);
    if (req.method === "PATCH") {
      if (body.title !== undefined) c.title = requireName(body.title, "Title");
      if (body.summary !== undefined) c.summary = String(body.summary ?? "");
      if (body.tags !== undefined) {
        if (!Array.isArray(body.tags)) bad("Tags must be a list");
        c.tags = (body.tags as unknown[]).map(String).filter(Boolean);
      }
      if (body.variants !== undefined) {
        if (!Array.isArray(body.variants)) bad("Variants must be a list");
        c.variants = (body.variants as ContentVariant[]).map((v) => {
          if (!v || !ALL_FORMATS.includes(v.format)) bad(`Unknown format “${String(v?.format)}”`);
          const text = String(v.body ?? "");
          return { format: v.format, title: v.title ?? null, body: text, char_count: text.length };
        });
      }
      if (body.seo !== undefined && (body.seo === null || typeof body.seo === "object")) c.seo = body.seo;
      if (body.image_url !== undefined) {
        const cover = typeof body.image_url === "string" && body.image_url.trim() ? body.image_url.trim() : null;
        if (cover && !c.images.some((m) => m.url === cover)) c.images = [uploadedImage(cover), ...c.images];
        c.image_url = cover;
      }
      c.updated_at = now;
      return clone(c);
    }
    if (req.method === "DELETE") {
      st.content = st.content.filter((x) => x.id !== c.id);
      const run = c.run_id ? st.runs.find((r) => r.id === c.run_id) : undefined;
      if (run && !run.final && runView(run).status === "awaiting_approval") {
        run.contentIds = run.contentIds.filter((x) => x !== c.id);
        const left = run.contentIds.map((x) => st.content.find((y) => y.id === x)).filter((y): y is ContentItem => !!y);
        if (left.some((y) => y.status === "approved") && !left.some((y) => y.status === "draft")) run.resumeAt = Date.now();
        else if (!left.length || !left.some((y) => y.status === "draft" || y.status === "approved")) run.skipAt = Date.now();
      }
      return undefined;
    }
    return UNHANDLED;
  }
  if (req.method !== "POST") return UNHANDLED;
  if (action === "approve") {
    if (c.status === "published") throw new DemoError(409, "already_published", "This content is already published");
    c.status = "approved";
    c.updated_at = now;
    addEvent(st, "content", `Approved “${clip(c.title, 64)}”`, "ok");
    settleRunAfterReview(st, c);
    tickStore(st);
    return clone(c);
  }
  if (action === "reject") {
    if (c.status === "published") throw new DemoError(409, "already_published", "Published content cannot be rejected; unpublish it on the site instead");
    c.status = "rejected";
    c.updated_at = now;
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    if (reason) c.quality = { score: c.quality?.score ?? 0, flags: [...(c.quality?.flags ?? []), `Rejected: ${reason}`] };
    addEvent(st, "content", `Rejected “${clip(c.title, 64)}”${reason ? `: ${reason}` : ""}`, "warn");
    settleRunAfterReview(st, c);
    tickStore(st);
    return clone(c);
  }
  if (action === "publish") {
    if (c.status === "rejected") throw new DemoError(409, "content_rejected", "Rejected content cannot be published. Approve it first.");
    const ids = Array.isArray(body.connection_ids) && body.connection_ids.length ? (body.connection_ids as string[]) : defaultPublishTargets(st, c);
    const unknown = ids.find((x) => !st.connections.some((k) => k.id === x));
    if (unknown) bad(`Unknown connection “${unknown}”`);
    if (!ids.length) bad("No connections to publish to. Add a connection first.", "no_connections");
    publishItem(st, c, ids, now);
    if (c.status === "published") settleRunAfterReview(st, c);
    return clone(c);
  }
  return UNHANDLED;
}

function handleDatasets(req: DemoRequest, st: Store): unknown {
  const [, id, sub, recId] = req.segments;
  const body = req.body ?? {};
  if (!id) {
    if (req.method === "GET") return { items: st.datasets.map((d) => datasetView(st, d)) };
    if (req.method === "POST") {
      const name = requireName(body.name, "Name");
      const { fields, key_field } = validateFields(body.fields, body.key_field);
      const slug = slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : name);
      if (st.datasets.some((d) => d.slug === slug)) throw new DemoError(409, "slug_taken", `A dataset with the slug “${slug}” already exists`);
      const now = new Date().toISOString();
      const d: DatasetRec = { id: uid("ds_"), name, slug, description: typeof body.description === "string" ? body.description : "", key_field, fields, public: !!body.public, updated_at: now, created_at: now, template: null };
      st.datasets.push(d);
      st.records[d.id] = [];
      addEvent(st, "dataset", `Dataset ${name} created with ${fields.length} fields`, "ok");
      return datasetView(st, d);
    }
    return UNHANDLED;
  }
  const d = findDataset(st, id);
  if (!sub) {
    if (req.method === "GET") return datasetView(st, d);
    if (req.method === "PATCH") {
      if (body.name !== undefined) d.name = requireName(body.name, "Name");
      if (body.description !== undefined) d.description = String(body.description ?? "");
      if (body.public !== undefined) d.public = !!body.public;
      if (body.slug !== undefined) {
        const s = slugify(String(body.slug || d.name));
        if (st.datasets.some((x) => x.slug === s && x.id !== d.id)) throw new DemoError(409, "slug_taken", `A dataset with the slug “${s}” already exists`);
        d.slug = s;
      }
      if (body.fields !== undefined || body.key_field !== undefined) {
        const v = validateFields(body.fields ?? d.fields, body.key_field ?? d.key_field);
        d.fields = v.fields;
        if (v.key_field !== d.key_field) {
          d.key_field = v.key_field;
          for (const r of st.records[d.id] ?? []) r.key = String(r.data[v.key_field] ?? r.key);
        }
      }
      d.updated_at = new Date().toISOString();
      return datasetView(st, d);
    }
    if (req.method === "DELETE") {
      const user = st.agents.find((a) => a.config.dataset === d.id);
      if (user) throw new DemoError(409, "dataset_in_use", `${d.name} is used by the agent “${user.name}”. Point it at another dataset first.`);
      st.datasets = st.datasets.filter((x) => x.id !== d.id);
      delete st.records[d.id];
      addEvent(st, "dataset", `Dataset ${d.name} deleted`, "info");
      return undefined;
    }
    return UNHANDLED;
  }
  if (sub === "records") {
    const list = (st.records[d.id] ??= []);
    if (!recId) {
      if (req.method === "GET") {
        let items = [...list];
        if (req.query.q) {
          const q = req.query.q.toLowerCase();
          items = items.filter((r) => r.key.toLowerCase().includes(q) || Object.values(r.data).some((v) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")).toLowerCase().includes(q)));
        }
        if (req.query.sort) {
          const [field, dirRaw] = req.query.sort.split(":");
          const dir = dirRaw === "desc" ? -1 : 1;
          items.sort((a, b) => {
            const x = field === "updated_at" || field === "created_at" ? a[field] : field === "key" ? a.key : a.data[field];
            const y = field === "updated_at" || field === "created_at" ? b[field] : field === "key" ? b.key : b.data[field];
            if (x === null || x === undefined || x === "") return 1;
            if (y === null || y === undefined || y === "") return -1;
            if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
            return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
          });
        }
        return clone(paginate(items, req.query, 50)) as Paged<DatasetRecord>;
      }
      if (req.method === "POST") {
        if (!body.data || typeof body.data !== "object") bad("Body must include a data object");
        const { rec, created } = upsertRecord(st, d, body.data, typeof body.source_url === "string" ? body.source_url : null);
        if (created) addEvent(st, "dataset", `Record ${rec.key} added to ${d.name}`, "ok");
        return clone(rec);
      }
      return UNHANDLED;
    }
    const rec = list.find((r) => r.id === recId || r.key === recId);
    if (!rec) notFound("Record");
    if (req.method === "GET") return clone(rec);
    if (req.method === "PATCH") {
      const data = body.data && typeof body.data === "object" ? coerceRow(d, body.data) : {};
      const merged = { ...rec.data, ...data };
      const newKey = String(merged[d.key_field] ?? rec.key).trim();
      if (!newKey) bad(`“${d.key_field}” (the key field) is required`);
      if (list.some((r) => r.id !== rec.id && r.key.toLowerCase() === newKey.toLowerCase())) throw new DemoError(409, "duplicate_key", `Another record already uses “${newKey}”`);
      rec.data = merged;
      rec.key = newKey;
      if (body.source_url !== undefined) rec.source_url = body.source_url ? String(body.source_url) : null;
      rec.updated_at = new Date().toISOString();
      d.updated_at = rec.updated_at;
      return clone(rec);
    }
    if (req.method === "DELETE") {
      st.records[d.id] = list.filter((r) => r.id !== rec.id);
      d.updated_at = new Date().toISOString();
      return undefined;
    }
    return UNHANDLED;
  }
  if (sub === "import" && req.method === "POST" && !recId) {
    if (!Array.isArray(body.rows)) bad("Body must include rows: a list of objects");
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of body.rows as unknown[]) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        skipped++;
        continue;
      }
      const kv = (row as Record<string, unknown>)[d.key_field];
      if (kv === undefined || kv === null || String(kv).trim() === "") {
        skipped++;
        continue;
      }
      const src = typeof (row as Record<string, unknown>).source_url === "string" ? String((row as Record<string, unknown>).source_url) : null;
      const data = { ...(row as Record<string, unknown>) };
      delete data.source_url;
      const r = upsertRecord(st, d, data, src);
      if (r.created) created++;
      else updated++;
    }
    addEvent(st, "dataset", `Imported into ${d.name}: ${created} new, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}`, skipped ? "warn" : "ok");
    return { created, updated, skipped };
  }
  return UNHANDLED;
}

function handleChat(req: DemoRequest, st: Store): ChatResponse {
  const body = (req.body ?? {}) as ChatRequest;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) bad("Message is required");
  let dsRef = body.dataset;
  let maxRecords = 4;
  if (body.assistant_id) {
    const a = agentOf(st, body.assistant_id);
    if (!a) notFound("Assistant");
    if (a.kind !== "comparison_assistant") bad(`${a.name} is not a comparison assistant`);
    dsRef = dsRef || (typeof a.config.dataset === "string" ? a.config.dataset : "");
    maxRecords = Number(a.config.max_records ?? 4) || 4;
  }
  if (!dsRef) bad("Pick a dataset or an assistant", "dataset_required");
  const ds = findDataset(st, dsRef);
  const started = Date.now();
  const res = runChat({ dataset: datasetView(st, ds), records: st.records[ds.id] ?? [], message, history: body.history, compareKeys: body.compare_keys, maxRecords });
  const latency = 600 + Math.floor(Math.random() * 800) + Math.min(50, Date.now() - started);
  return clone({ ...res, model: CHAT_MODEL, latency_ms: latency });
}

function handleConnections(req: DemoRequest, st: Store): unknown {
  const [, id, action] = req.segments;
  const body = req.body ?? {};
  const split = (kind: ConnectionKind, cfg: Record<string, unknown>) => {
    const info = connectionKind(kind);
    const secretKeys = new Set((info?.fields ?? []).filter((f) => f.secret).map((f) => f.key));
    const config: Record<string, unknown> = {};
    const secrets: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg ?? {})) {
      if (secretKeys.has(k)) {
        if (v !== null && v !== undefined && String(v) !== "") secrets[k] = String(v);
      } else config[k] = v;
    }
    for (const f of info?.fields ?? []) if (!f.secret && config[f.key] === undefined && f.default !== undefined) config[f.key] = f.default;
    return { config, secrets, secretKeys };
  };
  if (!id) {
    if (req.method === "GET") return { items: st.connections.map(connectionView) };
    if (req.method === "POST") {
      const kind = body.kind as ConnectionKind;
      const info = connectionKind(kind);
      if (!info) bad(`Unknown connection kind “${String(body.kind)}”`, "invalid_kind");
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : info.name;
      const { config, secrets } = split(kind, body.config ?? {});
      const c: ConnRec = { id: uid("con_"), name, kind, config, secrets, status: connStatus(kind, config, secrets), last_used_at: null, last_error: null, created_at: new Date().toISOString() };
      st.connections.push(c);
      addEvent(st, "connection", `Connection ${name} added${c.status === "needs_setup" ? `: missing ${missingFields(c).join(", ")}` : ""}`, c.status === "connected" ? "ok" : "warn");
      return connectionView(c);
    }
    return UNHANDLED;
  }
  const c = st.connections.find((x) => x.id === id);
  if (!c) notFound("Connection");
  if (action === "test" && req.method === "POST") {
    const latency = 120 + Math.floor(Math.random() * 520);
    const now = new Date().toISOString();
    let res: ConnectionTestResult;
    if (c.status === "needs_setup" || missingFields(c).length) {
      res = { ok: false, detail: `Missing ${missingFields(c).join(", ")}. Add ${missingFields(c).length > 1 ? "them" : "it"} and test again.`, latency_ms: null };
    } else {
      const cfg = c.config;
      const details: Partial<Record<ConnectionKind, string>> = {
        nextjs: `POST ${cfg.webhook_url} → 200 OK · signature verified by the receiver`,
        wordpress: `Authenticated as ${cfg.username} on ${cfg.site_url} · REST API v2 reachable`,
        webhook: `POST ${cfg.url} → 204 No Content`,
        linkedin: `Token valid for ${cfg.author_urn} · expires in 47 days`,
        telegram: `Bot can post to ${cfg.chat_id}`,
        x: `Found ${cfg.handle} · posts are prepared for manual posting (no API write access)`,
        ghost: `Admin API reachable at ${cfg.api_url} · Ghost 5.x`,
      };
      res = { ok: true, detail: details[c.kind] ?? `Connected to ${c.name}`, latency_ms: latency };
      c.last_error = null;
      if (c.status === "error") c.status = "connected";
    }
    c.last_used_at = now;
    addEvent(st, "connection", `Tested ${c.name}: ${res.ok ? "OK" : res.detail}`, res.ok ? "ok" : "warn");
    return res;
  }
  if (action) return UNHANDLED;
  if (req.method === "GET") return connectionView(c);
  if (req.method === "PATCH") {
    if (body.name !== undefined) c.name = requireName(body.name, "Name");
    if (body.config !== undefined) {
      const info = connectionKind(c.kind);
      const secretKeys = new Set((info?.fields ?? []).filter((f) => f.secret).map((f) => f.key));
      for (const [k, v] of Object.entries((body.config ?? {}) as Record<string, unknown>)) {
        if (secretKeys.has(k)) {
          if (v === null) delete c.secrets[k];
          else if (v !== undefined && String(v) !== "") c.secrets[k] = String(v);
        } else if (v === null || v === undefined) delete c.config[k];
        else c.config[k] = v;
      }
    }
    c.status = connStatus(c.kind, c.config, c.secrets);
    c.last_error = null;
    return connectionView(c);
  }
  if (req.method === "DELETE") {
    st.connections = st.connections.filter((x) => x.id !== c.id);
    for (const a of st.agents) if (Array.isArray(a.config.connections)) a.config.connections = (a.config.connections as string[]).filter((x) => x !== c.id);
    addEvent(st, "connection", `Connection ${c.name} removed`, "info");
    return undefined;
  }
  return UNHANDLED;
}

function handleApiKeys(req: DemoRequest, st: Store): unknown {
  const [, id] = req.segments;
  const body = req.body ?? {};
  if (!id) {
    if (req.method === "GET") return { items: clone(st.apiKeys) };
    if (req.method === "POST") {
      const name = requireName(body.name, "Name");
      const allowed: ApiScope[] = ["content:read", "datasets:read", "assistant:chat", "runs:write", "runs:read"];
      const scopes = Array.isArray(body.scopes) && body.scopes.length ? (body.scopes as ApiScope[]) : (["content:read"] as ApiScope[]);
      const badScope = scopes.find((s) => !allowed.includes(s));
      if (badScope) bad(`Unknown scope “${badScope}”`);
      const secret = `lf_pk_${randHex(40)}`;
      const key: ApiKey = { id: uid("key_"), name, prefix: secret.slice(0, 10), scopes: [...new Set(scopes)], last_used_at: null, created_at: new Date().toISOString(), revoked: false };
      st.apiKeys.unshift(key);
      addEvent(st, "connection", `API key ${name} created (${key.scopes.join(", ")})`, "ok");
      const out: ApiKeyCreated = { key: clone(key), secret };
      return out;
    }
    return UNHANDLED;
  }
  if (req.method === "DELETE" && req.segments.length === 2) {
    const k = st.apiKeys.find((x) => x.id === id);
    if (!k) notFound("API key");
    k.revoked = true;
    addEvent(st, "connection", `API key ${k.name} revoked`, "warn");
    return undefined;
  }
  return UNHANDLED;
}

function overview(): PlatformOverview {
  const workspaces: Workspace[] = [];
  const events: ActivityEvent[] = [];
  const days = new Map<string, { succeeded: number; failed: number }>();
  let queued = 0;
  let running = 0;
  for (const w of reg()) {
    const st = storeFor(w.slug);
    tickStore(st);
    const views = allViews(st);
    workspaces.push({ ...wsView(w), stats: wsStats(st, views) });
    events.push(...activity(st, views).slice(0, 12));
    for (const d of runsByDay(st, views)) {
      const cur = days.get(d.day) ?? { succeeded: 0, failed: 0 };
      cur.succeeded += d.succeeded;
      cur.failed += d.failed;
      days.set(d.day, cur);
    }
    for (const v of views) {
      if (v.status === "queued") queued++;
      if (v.status === "running") running++;
    }
  }
  const sum = (k: keyof WorkspaceStats) => workspaces.reduce((n, w) => n + w.stats[k], 0);
  return clone({
    totals: {
      workspaces: workspaces.length,
      agents: sum("agents"),
      pipelines: sum("pipelines"),
      runs_24h: sum("runs_24h"),
      failed_24h: sum("failed_24h"),
      content_7d: sum("content_7d"),
      published_7d: sum("published_7d"),
      records: sum("records"),
    },
    runs_by_day: [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v })),
    workspaces,
    activity: events.sort((a, b) => ms(b.at) - ms(a.at)).slice(0, 10),
    models: MODELS,
    provider: "ollama",
    queue: { queued, running },
  });
}

function workspaceDashboard(ws: WsBase, st: Store): WorkspaceDashboard {
  const views = allViews(st);
  return clone({
    workspace: { ...wsView(ws), stats: wsStats(st, views) },
    runs_by_day: runsByDay(st, views),
    recent_runs: views.slice(0, 5),
    pending_approval: st.content.filter((c) => c.status === "draft").length,
    recent_content: [...st.content].sort((a, b) => ms(b.created_at) - ms(a.created_at)).slice(0, 5),
    activity: activity(st, views).slice(0, 10),
  });
}

/* ====================================================================================== */
/* Entry point                                                                            */
/* ====================================================================================== */

const ROOTS = new Set(["platform", "workspaces", "blueprints", "dashboard", "agent-types", "agents", "pipelines", "runs", "content", "datasets", "assistant", "connection-kinds", "connections", "api-keys"]);

export const handlePlatform: DemoHandler = (req) => {
  const [root, a, b] = req.segments;
  if (!ROOTS.has(root)) return UNHANDLED;

  // catalog + operator routes (no active workspace needed)
  switch (root) {
    case "platform":
      return a === "overview" && req.segments.length === 2 && req.method === "GET" ? overview() : UNHANDLED;
    case "dashboard":
      if (a !== "workspace" || req.segments.length !== 2 || req.method !== "GET") return UNHANDLED;
      break;
    case "agent-types":
      return req.segments.length === 1 && req.method === "GET" ? { items: clone(AGENT_TYPES) } : UNHANDLED;
    case "connection-kinds":
      return req.segments.length === 1 && req.method === "GET" ? { items: clone(CONNECTION_KINDS) } : UNHANDLED;
    case "blueprints":
      if (req.segments.length === 1 && req.method === "GET") return { items: clone(BLUEPRINTS) };
      if (!(req.segments.length === 3 && b === "apply" && req.method === "POST")) return UNHANDLED;
      break;
    case "workspaces":
      return handleWorkspaces(req);
    case "assistant":
      if (!(a === "chat" && req.segments.length === 2 && req.method === "POST")) return UNHANDLED;
      break;
    default:
      break;
  }

  const slug = activeSlug(req);
  const ws = wsBase(slug) as WsBase;
  const st = storeFor(slug);
  tickStore(st);

  switch (root) {
    case "dashboard":
      return workspaceDashboard(ws, st);
    case "blueprints":
      return applyBlueprint(st, a);
    case "agents":
      return handleAgents(req, st, ws);
    case "pipelines":
      return handlePipelines(req, st, ws);
    case "runs":
      return handleRuns(req, st);
    case "content":
      return handleContent(req, st);
    case "datasets":
      return handleDatasets(req, st);
    case "assistant":
      return handleChat(req, st);
    case "connections":
      return handleConnections(req, st);
    case "api-keys":
      return handleApiKeys(req, st);
    default:
      return UNHANDLED;
  }
};

/** Workspaces for /auth/me (reflects created, edited and deleted workspaces). */
export function demoWorkspaceLites(): WorkspaceLite[] {
  return reg().map((w) => ({ id: w.id, slug: w.slug, name: w.name, industry: w.industry, brand_color: w.brand_color, modules: [...w.modules] }));
}

/** Full workspace (with live stats) or null. */
export function demoWorkspace(slug: string): Workspace | null {
  const w = wsBase(slug);
  return w ? wsView(w) : null;
}
