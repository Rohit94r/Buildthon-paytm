// In-memory mock of the newsroom API (feed, studio, review, SEO, calendar, social, settings, jobs, health).
// State lives in this module for the life of the tab; jobs progress on wall-clock time and are advanced on every request.

import { articleText, wordCount } from "@/lib/markdown";
import { dayKey, fromLocalInput } from "@/lib/tz";
import type {
  AgentHealthRow,
  AgentModel,
  ArticleBody,
  ArticleDetail,
  ArticleState,
  ArticleSummary,
  AuditEntry,
  Cadence,
  CalendarConflict,
  Category,
  Competitor,
  DashboardSummary,
  DryRun,
  EvalRun,
  FeedDetail,
  FeedItem,
  FeedList,
  Health,
  IntegrationsView,
  Job,
  JobEvent,
  ModelHealth,
  ModelsView,
  ModelTest,
  Paginated,
  PersonaView,
  PromptDetail,
  PromptListItem,
  PromptVersionRow,
  Publication,
  PublishTarget,
  Region,
  ResearchPack,
  ReviewActionOut,
  SearchResults,
  Section,
  SeoPayload,
  SiteAudit,
  SitePage,
  SocialConnection,
  SocialPost,
  Source,
  SourceKind,
  TenantInfo,
  TenantSettings,
  Topic,
  User,
  UserRow,
  Version,
  VersionPayload,
  WorkerHealth,
} from "@/lib/types";
import { DemoError, UNHANDLED, clone, hoursAgo, minutesAgo, notFound, seeded, slugify, uid, type DemoHandler, type DemoRequest, type DemoTenant } from "./core";
import { DEMO_UNAVAILABLE } from "./mode";
import {
  ARTICLE_SPECS,
  BANNED_PHRASES,
  COMPETITORS,
  EDITABLE_STATES,
  EVAL_CASES,
  FEED_SPECS,
  LEXICON_BODY,
  PERSONA_BODY,
  PLAYBOOKS,
  PROMPT_BODIES,
  SITE,
  SOURCE_SPECS,
  STAGE_ORDER,
  STAGE_STATE,
  STRUCTURE_BODY,
  canTransition,
  cardImage,
  composeBody,
  computeStats,
  makeEditor,
  makePack,
  makeQa,
  makeSeo,
  playbook,
  promptVersion,
  renderArticleHtml,
  roughDraft,
  runnableStages,
  type ArticleSpec,
  type FeedSpec,
} from "./newsroom-fixtures";

/* ====================================================================================== */
/* Types                                                                                  */
/* ====================================================================================== */

interface ArticleRec {
  id: string;
  title: string;
  dek: string;
  category: Category;
  state: ArticleState;
  slug: string | null;
  revision_count: number;
  last_error: string | null;
  published_url: string | null;
  topic_id: string | null;
  feed_id: string | null;
  created_at: string;
  updated_at: string;
  versions: Version[]; // newest first
  current_version_id: string | null;
  research_pack: ResearchPack | null;
  review_actions: ReviewActionOut[];
  subject: string;
  facts: string[];
  slugHint?: string;
  keyword: string;
  secondary: string[];
  sections?: Record<string, Partial<Section>>;
  takeaway?: string;
  /** Latest edited body: the edit stage keeps it instead of regenerating. */
  clean: ArticleBody | null;
  /** Research finds too little evidence on the next run. */
  thin: boolean;
  seed: number;
}

interface JobCtx {
  article_id?: string;
  /** Article job that must not move the article state (e.g. SEO regenerate). */
  keepState?: boolean;
  instruction?: string;
  pub_id?: string;
  post_id?: string;
  suite?: string;
  stage?: string;
}

interface JobRec {
  job: Job;
  ws: string;
  t0: number;
  delay: number;
  stageMs: number;
  stages: string[];
  started: number;
  finished: number;
  finalized: boolean;
  stop: boolean;
  fail: string | null;
  ctx: JobCtx;
}

interface WsState {
  tenant: TenantInfo;
  settings: TenantSettings;
  users: UserRow[];
  sources: Source[];
  prompts: Record<string, PromptVersionRow[]>;
  banned: string[];
  models: Record<string, AgentModel>;
  integrations: IntegrationsView;
  evalRuns: EvalRun[];
}

interface NewsStore {
  feed: FeedItem[];
  reserve: FeedItem[];
  facts: Record<string, { subject: string; facts: string[] }>;
  topics: Topic[];
  articles: ArticleRec[];
  pubs: Publication[];
  social: SocialPost[];
  audit: AuditEntry[];
  auditLiveAt: string | null;
  competitorsAt: string | null;
  lastDiscoveryAt: string;
}

/* ====================================================================================== */
/* Module state                                                                           */
/* ====================================================================================== */

const TEN = "ten";
const DELAY = 700;
const jobs: JobRec[] = [];
const events: JobEvent[] = [];
const workspaces: Record<string, WsState> = {};
let evSeq = 0;
let auditSeq = 0;
let news: NewsStore | null = null;

export const DEMO_OWNER_ID = "usr-demo-owner";

const iso = (ms: number) => new Date(ms).toISOString();
const nowIso = () => new Date().toISOString();
const daysAhead = (d: number) => iso(Date.now() + d * 86_400_000);

/* ====================================================================================== */
/* Workspace settings (any workspace)                                                     */
/* ====================================================================================== */

export function demoUsers(tenant: DemoTenant): UserRow[] {
  const domain = tenant.domain ?? `${tenant.slug}.example`;
  return [
    { id: DEMO_OWNER_ID, email: "rohit@layerflow.dev", name: "Rohit Mehra", role: "owner", active: true, last_login_at: minutesAgo(3) },
    { id: "usr-demo-editor", email: `daniel.okafor@${domain}`, name: "Daniel Okafor", role: "editor", active: true, last_login_at: hoursAgo(5) },
    { id: "usr-demo-reviewer", email: `mei.tanaka@${domain}`, name: "Mei Tanaka", role: "reviewer", active: true, last_login_at: hoursAgo(26) },
  ];
}

function defaultSettings(tenant: DemoTenant, siteUrl: string): TenantSettings {
  const isTen = tenant.slug === TEN;
  return {
    brand: {
      name: tenant.name,
      short_name: isTen ? "TEN" : tenant.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 4).toUpperCase(),
      site_url: siteUrl,
      og_image_url: "",
      author_name: `${tenant.name} Editorial`,
      author_bio: "Analysis for CEOs, founders and senior operators.",
      powered_by: "Powered by LayerFlow",
    },
    spelling: "en-US",
    cadence: { per_day: 2, slots: ["08:30", "17:30"], weekdays_only: true, max_per_category_per_day: 1 },
    scoring: { recency: 0.3, entity: 0.25, signal: 0.2, source: 0.15, novelty: 0.1 },
    watchlist: {
      companies: ["Kestrel Semiconductor", "Meridian Bank", "Northwind Retail", "Halvorsen Freight", "Orbis Energy", "Vantage Telecom", "Solace Pharmaceuticals"],
      people: [],
      sectors: ["artificial intelligence", "semiconductors", "banking", "fintech", "logistics", "energy transition", "manufacturing", "retail", "telecom", "pharmaceuticals"],
      regions: ["india", "us", "global"],
    },
    avoid: { companies: [], topics: ["celebrity", "horoscope", "sports score"] },
    discovery: { lookback_hours: 24, max_items: 300, llm_enrich: true, enrich_top_k: 12, auto_disable_after_failures: 5, interval_minutes: 30, embeddings: true },
    research: { max_fetches: 6, min_sources: 2, max_facts: 12 },
    quality: { max_revisions: 2, duplication_max: 0.08, flesch_min: 45, flesch_max: 65, avg_sentence_max: 24 },
    models: { agents: {} },
    publishing: { default_target: "ten_static" },
    social: { emoji: false, link_in_post: true, author_type: "organization" },
  };
}

function seedSources(): Source[] {
  return SOURCE_SPECS.map((s, i) => ({
    id: `src-${s.key}`,
    kind: s.kind,
    name: s.name,
    url: s.url,
    weight: s.weight,
    region: s.region,
    group: s.group,
    tier: s.tier,
    active: s.active,
    last_fetched_at: s.active ? minutesAgo(18 + i * 2) : null,
    last_error: s.error ?? null,
    consecutive_failures: s.failures ?? 0,
    last_item_count: s.active && !s.error ? 20 + ((i * 7) % 30) : s.error ? 0 : null,
    last_latency_ms: s.active ? 240 + i * 130 : null,
    items_7d: s.items_7d,
    created_at: hoursAgo(24 * 40),
  }));
}

function ws(req: DemoRequest): WsState {
  const key = req.workspace || TEN;
  if (workspaces[key]) return workspaces[key];
  const t = req.tenant;
  const siteUrl = key === TEN ? SITE : t.domain ? `https://${t.domain}` : `https://${key}.example`;
  const settings = defaultSettings(t, siteUrl);
  const models: Record<string, AgentModel> = {
    discovery: { model: "llama3.2:3b", temperature: 0.2, num_ctx: 4096, max_tokens: 400 },
    research: { model: "qwen2.5:14b-instruct", temperature: 0.2, num_ctx: 16384, max_tokens: 1600 },
    writer: { model: "qwen2.5:14b-instruct", temperature: 0.7, num_ctx: 16384, max_tokens: 1800 },
    editor: { model: "qwen2.5:14b-instruct", temperature: 0.3, num_ctx: 16384, max_tokens: 1800 },
    seo: { model: "llama3.2:3b", temperature: 0.3, num_ctx: 4096, max_tokens: 600 },
    critic: { model: "qwen2.5:14b-instruct", temperature: 0.1, num_ctx: 16384, max_tokens: 1200 },
    linkedin: { model: "llama3.2:3b", temperature: 0.6, num_ctx: 4096, max_tokens: 700 },
  };
  settings.models = { agents: models };
  const orgUrn = "urn:li:organization:90210417";
  const state: WsState = {
    tenant: { id: `tnt-${key}`, slug: t.slug || key, name: t.name, domain: t.domain, timezone: t.timezone || "UTC", site_url: siteUrl },
    settings,
    users: demoUsers(t),
    sources: seedSources(),
    prompts: Object.fromEntries(
      Object.entries({ ...PROMPT_BODIES, "persona/ten": PERSONA_BODY }).map(([k, body]) => [k, [promptVersion(k, body, null)]]),
    ),
    banned: [...BANNED_PHRASES],
    models,
    integrations: {
      default_target: "ten_static",
      targets: {
        export: { configured: true, label: "Export bundle", always_available: true },
        ten_static: {
          configured: true,
          mode: "local",
          site_url: siteUrl,
          public_root: "/srv/site/public",
          sftp_host: null,
          sftp_port: 22,
          sftp_user: null,
          sftp_key_path: null,
          password_configured: false,
          note: "No SFTP host configured: pages publish to the local staging site (/site/…) plus an export bundle.",
        },
        wordpress: { configured: false, url: null, user: null, password_configured: false },
        webhook: { configured: true, url: "https://hooks.example.com/layerflow/publish", secret_configured: true },
      },
      linkedin: {
        client_id: "86x1demo4k2q",
        client_id_set: true,
        client_secret_set: true,
        redirect_uri: "https://app.layerflow.example/api/v1/settings/integrations/linkedin/callback",
        org_urn: orgUrn,
        author_type: "organization",
        connected: true,
        author_urn: orgUrn,
        expires_at: daysAhead(45),
        last_refresh_error: null,
      },
    },
    evalRuns: [evalRun("deterministic", "rules", 6, hoursAgo(50))],
  };
  workspaces[key] = state;
  return state;
}

function evalRun(suite: string, model: string, passed: number, createdAt: string): EvalRun {
  const details = EVAL_CASES.map((c, i) => ({ case: c.id, expected: c.expected, ok: i < passed, verdict: i < passed ? (c.expected?.split(":")[0] ?? "pass") : "pass", gates_failed: c.label === "adversarial" ? [c.expected?.split(": ")[1] ?? "grounding"] : [] }));
  return {
    id: uid("eval-"),
    agent: suite,
    model,
    scores: suite === "deterministic" ? { hallucination_catch_rate: 1, false_block_rate: 0, injection_ignored: 1 } : { hallucination_catch_rate: passed / 6, false_block_rate: 0, mean_overall: 81.5, critic_agreement: 0.83 },
    passed,
    total: EVAL_CASES.length,
    created_at: createdAt,
    details,
  };
}

function owner(req: DemoRequest): User {
  const u = ws(req).users.find((x) => x.id === DEMO_OWNER_ID) ?? ws(req).users[0];
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/* ====================================================================================== */
/* Audit + events                                                                         */
/* ====================================================================================== */

function addAudit(e: Omit<AuditEntry, "id" | "created_at"> & { created_at?: string }) {
  if (!news) return;
  auditSeq += 1;
  news.audit.unshift({ id: auditSeq, created_at: e.created_at ?? nowIso(), ...e });
}

function addEvent(job_id: string | null, article_id: string | null, message: string, at: string, level: "info" | "warn" | "error" = "info", data: Record<string, unknown> | null = null) {
  evSeq += 1;
  events.push({ id: evSeq, job_id, article_id, level, message, data, created_at: at });
}

/* ====================================================================================== */
/* Seed (ten newsroom)                                                                    */
/* ====================================================================================== */

function pubHost(publisher: string): string {
  return `${slugify(publisher).replace(/-/g, "")}.example`;
}

function feedItem(spec: FeedSpec): FeedItem {
  const src = SOURCE_SPECS.find((s) => s.key === spec.source) ?? SOURCE_SPECS[0];
  const r = seeded(spec.key);
  const comp = (base: number) => Math.round(Math.max(0.05, Math.min(1, base + (r() - 0.5) * 0.3)) * 100) / 100;
  const url = `https://www.${pubHost(spec.publisher)}/${spec.path}`;
  return {
    id: `fi-${spec.key}`,
    title: spec.title,
    url,
    canonical_url: url,
    publisher: spec.publisher,
    summary: spec.summary,
    image_url: null,
    image_width: null,
    image_height: null,
    image_source: null,
    published_at: hoursAgo(spec.hours + 0.6),
    fetched_at: hoursAgo(spec.hours),
    source: { id: `src-${src.key}`, name: src.name, kind: src.kind },
    lang: "en",
    entities: spec.entities.map((e, i) => ({ ...e, prominence: Math.round((0.9 - i * 0.2) * 100) / 100 })),
    region: spec.region,
    score: spec.score,
    score_breakdown: { recency: comp(spec.score + 0.1), entity: comp(spec.score), signal: comp(spec.score - 0.05), source: Math.round((src.weight / 1.5) * 100) / 100, novelty: comp(spec.score - 0.1), signals: spec.signals },
    suggested_category: spec.category,
    category_reason: spec.reason,
    why_it_matters: spec.why,
    dedupe_cluster_id: spec.cluster ?? null,
    is_cluster_head: spec.cluster ? Boolean(spec.head) : true,
    cluster_size: spec.cluster && spec.head ? 2 : null,
    status: spec.status,
    ignored_reason: spec.ignored ?? null,
    topic_id: null,
    article_id: null,
  };
}

function packSources(a: ArticleRec, item: FeedItem | null): { url: string; title: string; publisher: string; published_at: string | null }[] {
  const out: { url: string; title: string; publisher: string; published_at: string | null }[] = [];
  if (item) out.push({ url: item.url, title: item.title, publisher: item.publisher ?? "Source", published_at: item.published_at });
  const company = slugify(a.subject.split(/[’']/)[0] || a.title).split("-")[0] || "company";
  out.push({ url: `https://ir.${company}.example/news/${a.slug ?? slugify(a.title)}`, title: `${a.subject.replace(/^\w/, (c) => c.toUpperCase())}: company announcement`, publisher: "Company investor relations", published_at: item?.published_at ?? a.created_at });
  out.push({ url: `https://www.asiamarketswire.example/analysis/${slugify(a.title).slice(0, 40)}`, title: `Analysts weigh ${a.subject}`, publisher: "Asia Markets Wire", published_at: a.created_at });
  if (!item) out.push({ url: `https://www.boardroomledger.example/insight/${slugify(a.subject)}`, title: `What ${a.subject} means for operators`, publisher: "The Boardroom Ledger", published_at: a.created_at });
  return out;
}

function buildPack(a: ArticleRec, at: string, insufficient?: string): ResearchPack {
  const item = a.feed_id ? (news?.feed.find((f) => f.id === a.feed_id) ?? null) : null;
  const sources = insufficient ? packSources(a, item).slice(0, 1) : packSources(a, item);
  return makePack({
    id: uid("rp-"),
    summary: insufficient
      ? `Only one independent source covers ${a.subject} so far. The research agent will not write from a single document.`
      : `${a.facts[0] ?? a.title} ${a.facts[1] ?? ""} The pack separates announced commitments from forecasts and flags what is still unconfirmed.`.trim(),
    facts: insufficient ? a.facts.slice(0, 2) : a.facts,
    sources,
    createdAt: at,
    insufficient,
  });
}

function bodyFor(a: ArticleRec): ArticleBody {
  return composeBody({ title: a.title, dek: a.dek, category: a.category, subject: a.subject, facts: a.facts, sections: a.sections, takeaway: a.takeaway, seed: a.seed + a.revision_count * 7 });
}

function addVersion(a: ArticleRec, stage: string, payload: VersionPayload, at: string, note: string | null, createdBy: string | null = null): Version {
  const v: Version = {
    id: uid("ver-"),
    stage,
    prompt_version: stage === "write" ? "agents/writer@1.0.0" : stage === "edit" ? "agents/editor@1.0.0" : stage === "seo" ? "agents/seo@1.0.0" : stage === "qa" ? "agents/critic@1.0.0" : null,
    model_run_id: createdBy ? null : uid("mr-"),
    note,
    created_by: createdBy,
    created_at: at,
    word_count: payload.article ? wordCount(articleText({ ...payload.article, title: "", dek: "" })) : null,
    payload,
  };
  a.versions.unshift(v);
  a.current_version_id = v.id;
  a.updated_at = at;
  return v;
}

function currentPayload(a: ArticleRec): VersionPayload {
  return a.versions.find((v) => v.id === a.current_version_id)?.payload ?? {};
}

function seoFor(a: ArticleRec, body: ArticleBody, at: string, overrides?: Partial<SeoPayload>): SeoPayload {
  return makeSeo(body, { keyword: a.keyword, secondary: a.secondary, slug: a.slug ?? a.slugHint, sources: a.research_pack?.payload.sources ?? [], generatedAt: at, overrides });
}

/** Applies the effect of one finished pipeline stage to an article (shared by seed and live jobs). */
function applyStage(a: ArticleRec, stage: string, at: string, opts: { instruction?: string } = {}): { stop?: string; message: string } {
  if (stage === "research") {
    if (a.thin) {
      const reason = "Only 1 independent source (minimum 2). The filing is the only primary document so far.";
      a.research_pack = buildPack(a, at, reason);
      return { stop: reason, message: `Research refused: ${reason}` };
    }
    a.research_pack = buildPack(a, at);
    const p = a.research_pack.payload;
    return { message: `Research pack ready: ${p.key_facts.length} key facts from ${p.coverage.source_count} sources (${p.coverage.independent_publishers} publishers)` };
  }
  if (stage === "write") {
    const clean = bodyFor(a);
    a.clean = clean;
    const draft = roughDraft(clean);
    addVersion(a, "write", { article: draft, stats: computeStats(draft, a.seed), sources_meta: [] }, at, opts.instruction ? `Revision: ${opts.instruction}` : "First draft");
    return { message: `Draft written: ${wordCount(articleText({ ...draft, title: "", dek: "" }))} words across ${draft.sections.length} sections` };
  }
  if (stage === "edit") {
    const body = a.clean ?? currentPayload(a).article ?? bodyFor(a);
    a.clean = body;
    addVersion(a, "edit", { article: clone(body), editor: makeEditor(body), stats: computeStats(body, a.seed) }, at, opts.instruction ? `Edit pass: ${opts.instruction}` : "Edited for clarity and rhythm");
    return { message: "Edit done: 5 changes, 0 structural violations" };
  }
  if (stage === "seo") {
    const prev = currentPayload(a);
    const body = prev.article ?? a.clean ?? bodyFor(a);
    const seo = seoFor(a, body, at);
    a.slug = seo.slug;
    addVersion(a, "seo", { ...clone(prev), article: clone(body), seo }, at, "SEO metadata and schema");
    return { message: `SEO ready: score ${seo.score}/100, ${seo.internal_links.length} internal links` };
  }
  // qa
  const prev = currentPayload(a);
  const body = prev.article ?? a.clean ?? bodyFor(a);
  const stats = prev.stats ?? computeStats(body, a.seed);
  const spec = ARTICLE_SPECS.find((s) => `art-${s.key}` === a.id);
  const overall = spec?.qa || 80 + (a.seed % 9);
  const qa = makeQa(body, stats, overall, at);
  if (!prev.seo) prev.seo = seoFor(a, body, at);
  addVersion(a, "qa", { ...clone(prev), article: clone(body), stats, qa }, at, `QA ${qa.verdict} ${qa.overall}/100`);
  return { message: `QA ${qa.verdict} ${qa.overall}/100${qa.verdict === "pass" ? " → review queue" : ""}` };
}

const STAGE_START: Record<string, string> = {
  research: "A2 Research: reading sources and building the evidence pack",
  write: "A3 Writer: outlining the required sections",
  edit: "A4 Editor: tightening for clarity and rhythm",
  seo: "A5 SEO: title, meta, schema and internal links",
  qa: "A6 Critic: scoring the draft against the research pack",
};

const AGENT_OF: Record<string, string> = { research: "research", write: "writer", edit: "editor", seo: "seo", qa: "critic", discover: "discovery", social: "linkedin", distribute: "linkedin", publish: "publisher" };

function seededJob(type: string, articleId: string | null, startMs: number, durMs: number, opts: { status?: Job["status"]; error?: string; result?: Record<string, unknown> | null; attempts?: number } = {}): Job {
  const status = opts.status ?? "done";
  const job: Job = {
    id: uid("job-"),
    type,
    status,
    article_id: articleId,
    priority: 5,
    attempts: opts.attempts ?? 1,
    max_attempts: 3,
    available_at: iso(startMs - 2000),
    locked_at: iso(startMs),
    locked_by: "worker-1",
    last_error: opts.error ?? null,
    payload: articleId ? { article_id: articleId } : {},
    result: opts.result ?? (status === "done" ? { outcome: "ok" } : null),
    created_at: iso(startMs - 2000),
    started_at: iso(startMs),
    finished_at: iso(startMs + durMs),
    duration_ms: durMs,
  };
  jobs.push({ job, ws: TEN, t0: startMs - 2000, delay: 0, stageMs: durMs, stages: [type], started: 1, finished: 1, finalized: true, stop: false, fail: null, ctx: { article_id: articleId ?? undefined } });
  return job;
}

function seedNews(req: DemoRequest): NewsStore {
  const store: NewsStore = { feed: [], reserve: [], facts: {}, topics: [], articles: [], pubs: [], social: [], audit: [], auditLiveAt: null, competitorsAt: hoursAgo(30), lastDiscoveryAt: minutesAgo(18) };
  news = store;
  const settings = ws(req);
  const reviewer = settings.users.find((u) => u.role === "reviewer") ?? settings.users[0];
  const ownerUser = settings.users[0];
  for (const spec of FEED_SPECS) {
    const item = feedItem(spec);
    store.facts[item.id] = { subject: spec.subject, facts: spec.facts };
    (spec.reserve ? store.reserve : store.feed).push(item);
  }

  ARTICLE_SPECS.forEach((spec: ArticleSpec, idx) => {
    const item = spec.feed ? (store.feed.find((f) => f.id === `fi-${spec.feed}`) ?? null) : null;
    const fspec = spec.feed ? FEED_SPECS.find((f) => f.key === spec.feed) : undefined;
    const created = Date.now() - (spec.hours + 2) * 3_600_000;
    const topic: Topic = {
      id: `tpc-${spec.key}`,
      feed_item_id: item?.id ?? null,
      category: spec.category,
      title: item?.title ?? spec.title,
      angle: spec.angle,
      region: spec.region,
      notes: null,
      links: [],
      status: "in_progress",
      created_at: iso(created),
    };
    store.topics.push(topic);
    const a: ArticleRec = {
      id: `art-${spec.key}`,
      title: spec.title,
      dek: spec.dek,
      category: spec.category,
      state: "queued",
      slug: null,
      revision_count: 0,
      last_error: null,
      published_url: null,
      topic_id: topic.id,
      feed_id: item?.id ?? null,
      created_at: iso(created),
      updated_at: iso(created),
      versions: [],
      current_version_id: null,
      research_pack: null,
      review_actions: [],
      subject: spec.subject ?? fspec?.subject ?? spec.title,
      facts: spec.facts ?? fspec?.facts ?? [],
      slugHint: spec.slug,
      keyword: spec.keyword,
      secondary: spec.secondary,
      sections: spec.sections,
      takeaway: spec.takeaway,
      clean: null,
      thin: spec.state === "needs_sources",
      seed: idx * 5 + 3,
    };
    if (item) {
      item.topic_id = topic.id;
      item.article_id = a.id;
      item.status = "promoted";
    }
    store.articles.push(a);
    addAudit({ actor_type: "user", actor_id: ownerUser.id, actor_label: ownerUser.name, action: item ? "feed.promote" : "topic.create", entity: "article", entity_id: a.id, detail: { category: spec.category }, entity_label: a.title, created_at: iso(created) });

    const stages: string[] = spec.state === "queued" ? [] : spec.state === "drafting" ? ["research", "write"] : spec.state === "needs_sources" ? ["research"] : [...STAGE_ORDER];
    let t = created + 90_000;
    for (const stage of stages) {
      const dur = { research: 48_000, write: 212_000, edit: 96_000, seo: 31_000, qa: 74_000 }[stage] ?? 60_000;
      const at = iso(t + dur);
      const res = applyStage(a, stage, at);
      const job = seededJob(stage, a.id, t, dur, { result: res.stop ? { outcome: "needs_sources", reason: res.stop } : { outcome: "ok" } });
      addEvent(job.id, a.id, STAGE_START[stage], iso(t));
      addEvent(job.id, a.id, res.message, at, res.stop ? "warn" : "info");
      const from = a.state;
      a.state = (res.stop ? "needs_sources" : STAGE_STATE[stage]) as ArticleState;
      addAudit({ actor_type: "agent", actor_id: AGENT_OF[stage], actor_label: null, action: "article.transition", entity: "article", entity_id: a.id, detail: { from, to: a.state }, entity_label: a.title, created_at: iso(t) });
      if (res.stop) {
        a.last_error = res.stop;
        a.thin = false; // a re-run in the demo finds a second source
      }
      t += dur + 25_000;
    }
    const after = iso(t);
    if (["in_review", "approved", "scheduled", "published"].includes(spec.state)) {
      a.state = "in_review";
      addAudit({ actor_type: "agent", actor_id: "critic", actor_label: null, action: "article.transition", entity: "article", entity_id: a.id, detail: { from: "qa", to: "in_review" }, entity_label: a.title, created_at: after });
    }
    if (["approved", "scheduled", "published"].includes(spec.state)) {
      const at = iso(t + 3_600_000);
      a.review_actions.unshift({ id: uid("ra-"), action: "approve", reason: null, user: { id: reviewer.id, email: reviewer.email, name: reviewer.name, role: reviewer.role }, created_at: at });
      a.state = "approved";
      a.updated_at = at;
      addAudit({ actor_type: "user", actor_id: reviewer.id, actor_label: reviewer.name, action: "review.approve", entity: "article", entity_id: a.id, detail: {}, entity_label: a.title, created_at: at });
    }
    if (spec.state === "published") {
      const pubAt = Date.now() - spec.hours * 3_600_000;
      const live = `${SITE}${playbook(a.category).route}/${a.slug}`;
      const job = seededJob("publish", a.id, pubAt - 20_000, 18_000);
      addEvent(job.id, a.id, "Publisher: rendering page and export bundle", iso(pubAt - 20_000));
      addEvent(job.id, a.id, `Published to ten_static: ${live}`, iso(pubAt - 2000));
      store.pubs.push(newPublication(a, "ten_static", iso(pubAt), { status: "published", published_at: iso(pubAt), live_url: live, created_at: iso(pubAt - 6 * 3_600_000) }));
      a.state = "published";
      a.published_url = live;
      a.updated_at = iso(pubAt);
      addAudit({ actor_type: "system", actor_id: "publisher", actor_label: null, action: "publication.published", entity: "article", entity_id: a.id, detail: { target: "ten_static", live_url: live }, entity_label: a.title, created_at: iso(pubAt) });
    }
  });

  // Scheduled article takes the next free cadence slot.
  const sched = store.articles.find((a) => a.id === "art-ai-platform");
  if (sched) {
    const slot = nextSlot(req, sched.category, store.pubs);
    store.pubs.push(newPublication(sched, "ten_static", slot.at, { created_at: hoursAgo(20) }));
    sched.state = "scheduled";
    addAudit({ actor_type: "user", actor_id: ownerUser.id, actor_label: ownerUser.name, action: "article.transition", entity: "article", entity_id: sched.id, detail: { from: "approved", to: "scheduled", reason: `scheduled for ${slot.at}` }, entity_label: sched.title, created_at: hoursAgo(20) });
  }

  // Social posts.
  const meridian = store.articles.find((a) => a.id === "art-meridian");
  if (meridian) {
    const p = makePost(meridian, hoursAgo(58));
    p.status = "published";
    p.published_at = hoursAgo(57);
    p.remote_urn = "urn:li:share:7262018841150283776";
    store.social.push(p);
  }
  if (sched) store.social.push(makePost(sched, hoursAgo(19)));
  const supplier = store.articles.find((a) => a.id === "art-supplier");
  if (supplier) {
    const p = makePost(supplier, hoursAgo(9));
    p.status = "approved";
    store.social.push(p);
  }

  // Failed jobs: visible and retryable on the dashboard.
  const optionality = store.articles.find((a) => a.id === "art-optionality");
  if (optionality) {
    const j = seededJob("social", optionality.id, Date.now() - 22 * 3_600_000, 6200, { status: "failed", error: "LinkedIn draft model call timed out after 600 s (llama3.2:3b busy with a writer job). Retry when the queue is idle.", result: null, attempts: 3 });
    addEvent(j.id, optionality.id, "A9 LinkedIn: drafting post", iso(Date.now() - 22 * 3_600_000));
    addEvent(j.id, optionality.id, "Model call timed out after 600 s", iso(Date.now() - 22 * 3_600_000 + 6200), "error");
    addAudit({ actor_type: "system", actor_id: "worker", actor_label: null, action: "job.failed", entity: "job", entity_id: j.id, detail: { type: "social", status: "failed", error: j.last_error }, entity_label: optionality.title, created_at: j.finished_at ?? undefined });
  }
  const crawl = seededJob("crawl_competitors", null, Date.now() - 30 * 3_600_000, 41_000, { status: "dead", error: "strategy-business.com: robots.txt disallows /article/ for LayerFlowBot; 0 pages parsed", result: null, attempts: 3 });
  addAudit({ actor_type: "system", actor_id: "worker", actor_label: null, action: "job.failed", entity: "job", entity_id: crawl.id, detail: { type: "crawl_competitors", status: "dead", error: crawl.last_error }, entity_label: null, created_at: crawl.finished_at ?? undefined });
  const disc = seededJob("discover", null, Date.now() - 18 * 60_000, 23_000, { result: { new_items: 14, unique_stories: 11, sources_ok: 5, sources: 6 } });
  addEvent(disc.id, null, "A1 Discovery: fetched 6 sources, 1 failed (Asia Industry Journal: HTTP 503)", iso(Date.now() - 18 * 60_000 + 23_000), "warn");
  addAudit({ actor_type: "agent", actor_id: "discovery", actor_label: null, action: "discovery.run", entity: "feed", entity_id: null, detail: { new_items: 14, sources_ok: 5, sources: 6 }, entity_label: null, created_at: disc.finished_at ?? undefined });

  // Chronological ids for events and audit entries.
  events.sort((x, y) => (x.created_at ?? "").localeCompare(y.created_at ?? ""));
  events.forEach((e, i) => (e.id = i + 1));
  evSeq = events.length;
  store.audit.sort((x, y) => (y.created_at ?? "").localeCompare(x.created_at ?? ""));
  store.audit.forEach((e, i) => (e.id = store.audit.length - i));
  auditSeq = store.audit.length;
  return store;
}

function tenStore(req: DemoRequest): NewsStore {
  return news ?? seedNews(req);
}

/* ====================================================================================== */
/* Job engine                                                                             */
/* ====================================================================================== */

function createJob(req: DemoRequest, type: string, opts: { article_id?: string | null; stages?: string[]; stageMs?: number; ctx?: JobCtx; payload?: Record<string, unknown>; fail?: string | null } = {}): Job {
  const stages = opts.stages ?? [type];
  const now = Date.now();
  const job: Job = {
    id: uid("job-"),
    type: stages[0] ?? type,
    status: "queued",
    article_id: opts.article_id ?? null,
    priority: 5,
    attempts: 0,
    max_attempts: 3,
    available_at: iso(now),
    locked_at: null,
    locked_by: null,
    last_error: null,
    payload: opts.payload ?? (opts.article_id ? { article_id: opts.article_id, stages } : {}),
    result: null,
    created_at: iso(now),
    started_at: null,
    finished_at: null,
    duration_ms: null,
  };
  const multi = stages.length > 1;
  jobs.push({ job, ws: req.workspace || TEN, t0: now, delay: DELAY, stageMs: opts.stageMs ?? (multi ? 850 : 2600), stages, started: 0, finished: 0, finalized: false, stop: false, fail: opts.fail ?? null, ctx: { ...opts.ctx, article_id: opts.article_id ?? undefined } });
  return clone(job);
}

function articleById(id: string | undefined): ArticleRec | undefined {
  return id ? news?.articles.find((a) => a.id === id) : undefined;
}

function moveState(a: ArticleRec, to: ArticleState, actor: { type: AuditEntry["actor_type"]; id: string | null; label: string | null }, reason?: string, at = nowIso()) {
  const from = a.state;
  if (from === to) return;
  a.state = to;
  a.updated_at = at;
  addAudit({ actor_type: actor.type, actor_id: actor.id, actor_label: actor.label, action: "article.transition", entity: "article", entity_id: a.id, detail: { from, to, ...(reason ? { reason } : {}) }, entity_label: a.title, created_at: at });
}

function stageStart(rec: JobRec, i: number, at: string) {
  const stage = rec.stages[i];
  rec.job.type = stage;
  const a = articleById(rec.ctx.article_id);
  if (a && STAGE_STATE[stage]) {
    if (!rec.ctx.keepState) moveState(a, STAGE_STATE[stage] as ArticleState, { type: "agent", id: AGENT_OF[stage] ?? stage, label: null }, undefined, at);
    addEvent(rec.job.id, a.id, STAGE_START[stage], at);
    return;
  }
  const msg: Record<string, string> = {
    discover: "A1 Discovery: fetching active sources",
    crawl_inventory: "Site crawl: reading sitemap.xml and internal links (1 req/s, robots.txt respected)",
    crawl_competitors: "Competitor crawl: scanning public pages of 5 sites",
    eval: `Evaluation: running the ${rec.ctx.suite ?? "deterministic"} suite on ${EVAL_CASES.length} golden cases`,
    social: "A9 LinkedIn: drafting the post from the published article",
    distribute: "Posting to LinkedIn via the official API",
    publish: "Publisher: rendering page, validating and writing the export bundle",
  };
  addEvent(rec.job.id, rec.ctx.article_id ?? null, msg[stage] ?? `${stage}: started`, at);
}

function stageEnd(rec: JobRec, i: number, at: string) {
  const stage = rec.stages[i];
  const a = articleById(rec.ctx.article_id);
  if (a && STAGE_STATE[stage]) {
    const res = applyStage(a, stage, at, { instruction: rec.ctx.instruction });
    addEvent(rec.job.id, a.id, res.message, at, res.stop ? "warn" : "info");
    if (res.stop) {
      rec.stop = true;
      a.last_error = res.stop;
      a.thin = false; // a later re-run finds a second source
      if (!rec.ctx.keepState) moveState(a, "needs_sources", { type: "agent", id: "research", label: null }, "insufficient evidence", at);
      rec.job.result = { outcome: "needs_sources", reason: res.stop };
    }
    return;
  }
  applyJobEffect(rec, at);
}

function finalize(rec: JobRec, at: string) {
  rec.finalized = true;
  const job = rec.job;
  job.finished_at = at;
  job.duration_ms = Math.max(0, Date.parse(at) - Date.parse(job.started_at ?? job.created_at ?? at));
  if (rec.fail) {
    job.status = "failed";
    job.last_error = rec.fail;
    addEvent(job.id, rec.ctx.article_id ?? null, rec.fail, at, "error");
    return;
  }
  job.status = "done";
  const a = articleById(rec.ctx.article_id);
  if (a && STAGE_STATE[rec.stages[0]]) {
    if (!rec.stop) {
      a.last_error = null;
      const last = rec.stages[rec.stages.length - 1];
      const qa = currentPayload(a).qa;
      if (last === "qa" && !rec.ctx.keepState) {
        moveState(a, qa?.verdict === "pass" ? "in_review" : "qa", { type: "agent", id: "critic", label: null }, undefined, at);
        if (qa) {
          job.result = { outcome: a.state, verdict: qa.verdict, overall: qa.overall };
        }
      }
      job.result ??= { outcome: "ok", stages: rec.stages };
      addAudit({ actor_type: "agent", actor_id: AGENT_OF[last] ?? last, actor_label: null, action: "job.done", entity: "article", entity_id: a.id, detail: { type: last }, entity_label: a.title, created_at: at });
    }
    return;
  }
  job.result ??= { outcome: "ok" };
}

function advance(rec: JobRec, now: number) {
  if (rec.finalized) return;
  if (now - rec.t0 < rec.delay) return;
  const job = rec.job;
  if (job.status === "queued") {
    job.status = "running";
    job.started_at = iso(rec.t0 + rec.delay);
    job.locked_at = job.started_at;
    job.locked_by = "worker-1";
    job.attempts += 1;
  }
  const n = rec.stages.length;
  let endAt = rec.t0 + rec.delay;
  for (let i = rec.finished; i < n; i++) {
    const startAt = rec.t0 + rec.delay + i * rec.stageMs;
    endAt = startAt + rec.stageMs;
    if (now < startAt) break;
    if (rec.started <= i) {
      rec.started = i + 1;
      stageStart(rec, i, iso(startAt));
    }
    if (now < endAt) break;
    rec.finished = i + 1;
    stageEnd(rec, i, iso(endAt));
    if (rec.stop) break;
  }
  if (rec.finished >= n || rec.stop) finalize(rec, iso(Math.min(now, endAt)));
}

function tick() {
  const now = Date.now();
  for (const rec of jobs) if (!rec.finalized) advance(rec, now);
}

function activeJob(articleId: string): Job | null {
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i].job;
    if (j.article_id === articleId && (j.status === "queued" || j.status === "running")) return j;
  }
  return null;
}

function jobOut(j: Job): Job {
  const a = articleById(j.article_id ?? undefined);
  return { ...clone(j), article_title: a?.title ?? null };
}

/* ---------- Effects of non-article jobs ---------- */

function applyJobEffect(rec: JobRec, at: string) {
  const job = rec.job;
  const wsState = workspaces[rec.ws];
  switch (job.type) {
    case "discover": {
      const found = rec.ws === TEN && news ? news.reserve.splice(0, 2) : [];
      for (const f of found) {
        f.fetched_at = at;
        f.published_at = iso(Date.parse(at) - 40 * 60_000);
        news?.feed.unshift(f);
      }
      const srcs = wsState?.sources.filter((s) => s.active) ?? [];
      for (const s of srcs) {
        s.last_fetched_at = at;
        if (s.last_error) s.consecutive_failures += 1;
        else s.last_item_count = 12 + (s.name.length % 20);
      }
      if (news && rec.ws === TEN) news.lastDiscoveryAt = at;
      const ok = srcs.filter((s) => !s.last_error).length;
      job.result = { new_items: found.length ? found.length + 7 : 3, unique_stories: found.length || 1, sources_ok: ok, sources: srcs.length };
      addEvent(job.id, null, `Stored ${job.result.new_items} new item(s), ${job.result.unique_stories} unique stor${found.length === 1 ? "y" : "ies"}; ${ok}/${srcs.length} sources ok`, at, ok < srcs.length ? "warn" : "info");
      addAudit({ actor_type: "agent", actor_id: "discovery", actor_label: null, action: "discovery.run", entity: "feed", entity_id: null, detail: { new_items: job.result.new_items, sources_ok: ok, sources: srcs.length }, entity_label: null, created_at: at });
      break;
    }
    case "crawl_inventory":
      if (news && rec.ws === TEN) news.auditLiveAt = at;
      job.result = { pages: 184, article_pages: 152, with_issues: 97 };
      addEvent(job.id, null, "Crawled 184 pages (152 articles); 97 with at least one issue", at);
      break;
    case "crawl_competitors":
      if (news && rec.ws === TEN) news.competitorsAt = at;
      job.result = { competitors: COMPETITORS.length, pages: 186 };
      addEvent(job.id, null, "Scanned 186 public pages across 5 competitors", at);
      break;
    case "eval": {
      const suite = rec.ctx.suite ?? "deterministic";
      const passed = suite === "deterministic" ? 6 : 5;
      const run = evalRun(suite, suite === "deterministic" ? "rules" : "qwen2.5:14b-instruct", passed, at);
      wsState?.evalRuns.unshift(run);
      job.result = { passed, total: run.total, run_id: run.id };
      addEvent(job.id, null, `${passed}/${run.total} cases passed`, at);
      break;
    }
    case "social": {
      const a = articleById(rec.ctx.article_id);
      if (a && news) {
        const existing = news.social.find((p) => p.article_id === a.id);
        if (existing) Object.assign(existing, makePost(a, at), { id: existing.id, created_at: existing.created_at });
        else news.social.unshift(makePost(a, at));
        job.result = { outcome: "ok", article_id: a.id };
        addEvent(job.id, a.id, "LinkedIn draft ready to review", at);
      }
      break;
    }
    case "distribute": {
      const p = news?.social.find((x) => x.id === rec.ctx.post_id);
      if (p) {
        p.status = "published";
        p.published_at = at;
        p.updated_at = at;
        p.remote_urn = `urn:li:share:72${Math.floor(Math.random() * 1e16)}`;
        job.result = { remote_urn: p.remote_urn };
        addEvent(job.id, p.article_id, `Posted to LinkedIn: ${p.remote_urn}`, at);
      }
      break;
    }
    case "publish": {
      const p = news?.pubs.find((x) => x.id === rec.ctx.pub_id);
      const a = p ? articleById(p.article_id) : undefined;
      if (p && a && news) {
        const live = p.target === "export" ? null : `${SITE}${playbook(a.category).route}/${a.slug ?? slugify(a.title)}`;
        p.status = "published";
        p.published_at = at;
        p.live_url = live;
        p.has_artifact = true;
        a.published_url = live;
        moveState(a, "published", { type: "system", id: "publisher", label: null }, undefined, at);
        job.result = { live_url: live, target: p.target };
        addEvent(job.id, a.id, live ? `Published to ${p.target}: ${live}` : "Export bundle written", at);
        addAudit({ actor_type: "system", actor_id: "publisher", actor_label: null, action: "publication.published", entity: "article", entity_id: a.id, detail: { target: p.target, live_url: live ?? "export bundle" }, entity_label: a.title, created_at: at });
        if (!news.social.some((s) => s.article_id === a.id)) news.social.unshift(makePost(a, at));
      }
      break;
    }
    default:
      job.result = { outcome: "ok" };
  }
}

/* ====================================================================================== */
/* Serializers                                                                            */
/* ====================================================================================== */

function topicRef(a: ArticleRec): ArticleSummary["topic"] {
  const t = news?.topics.find((x) => x.id === a.topic_id);
  return t ? { id: t.id, title: t.title, angle: t.angle, region: t.region, feed_item_id: t.feed_item_id } : null;
}

function summary(a: ArticleRec): ArticleSummary {
  const active = activeJob(a.id);
  const qa = currentPayload(a).qa ?? null;
  return {
    id: a.id,
    title: a.title,
    category: a.category,
    category_label: playbook(a.category).label,
    state: a.state,
    slug: a.slug,
    cover_image_url: null,
    quality_score: qa?.overall ?? null,
    revision_count: a.revision_count,
    last_error: a.last_error,
    published_url: a.published_url,
    topic: topicRef(a),
    active_job: active ? { id: active.id, type: active.type, status: active.status } : null,
    created_at: a.created_at,
    updated_at: a.updated_at,
    qa_verdict: qa?.verdict ?? null,
    qa_overall: qa?.overall ?? null,
  };
}

function detail(a: ArticleRec): ArticleDetail {
  const s = summary(a);
  const busy = Boolean(s.active_job);
  const payload = currentPayload(a);
  const stages = runnableStages(a.state, busy);
  const version = a.versions.find((v) => v.id === a.current_version_id) ?? null;
  return {
    ...s,
    current_version: version ? clone(version) : null,
    research_pack: a.research_pack ? clone(a.research_pack) : null,
    seo: payload.seo ? clone(payload.seo) : null,
    qa: payload.qa ? clone(payload.qa) : null,
    editor: payload.editor ? clone(payload.editor) : null,
    stats: payload.stats ? clone(payload.stats) : null,
    playbook: clone(playbook(a.category)),
    jobs: jobs.filter((r) => r.job.article_id === a.id).map((r) => clone(r.job)).reverse().slice(0, 40),
    publications: (news?.pubs ?? []).filter((p) => p.article_id === a.id).map(pubOut).reverse(),
    social_posts: (news?.social ?? []).filter((p) => p.article_id === a.id).map(socialOut),
    review_actions: clone(a.review_actions),
    allowed_actions: {
      run_stages: stages as ArticleDetail["allowed_actions"]["run_stages"],
      can_run_auto: !busy && stages.includes("research"),
      can_edit: EDITABLE_STATES.has(a.state) && !busy,
      can_approve: a.state === "in_review" && !busy,
      can_reject: ["in_review", "approved", "failed", "needs_sources", "queued"].includes(a.state) && !busy,
      can_request_revision: ["in_review", "approved"].includes(a.state) && !busy,
      can_force_review: ["failed", "qa"].includes(a.state) && Boolean(payload.article) && Boolean(payload.seo) && !busy,
      can_schedule: ["approved", "published"].includes(a.state) && !busy,
      can_restore: !busy && !["scheduled", "publishing"].includes(a.state),
      busy_reason: s.active_job ? `${s.active_job.type} job is ${s.active_job.status}` : null,
    },
  };
}

function pubWhen(p: Publication): string | null {
  return p.status === "published" ? (p.published_at ?? p.scheduled_at) : (p.scheduled_at ?? p.published_at);
}

function pubOut(p: Publication): Publication {
  const a = articleById(p.article_id);
  return {
    ...clone(p),
    article: a ? { id: a.id, title: a.title, category: a.category, slug: a.slug, state: a.state } : null,
    late: p.status === "scheduled" && Boolean(p.scheduled_at) && Date.parse(p.scheduled_at as string) < Date.now(),
  };
}

function newPublication(a: ArticleRec, target: PublishTarget, scheduledAt: string, extra: Partial<Publication> = {}): Publication {
  const hash = slugify(`${a.id}-${a.current_version_id}-${target}`).replace(/-/g, "").slice(0, 32);
  return {
    id: uid("pub-"),
    article_id: a.id,
    article: null,
    version_id: a.current_version_id,
    target,
    status: "scheduled",
    scheduled_at: scheduledAt,
    published_at: null,
    remote_id: null,
    live_url: null,
    idempotency_key: `${hash}${"0".repeat(Math.max(0, 40 - hash.length))}`,
    content_hash: `sha256:${hash}`,
    last_error: null,
    has_artifact: false,
    warnings: [],
    late: false,
    created_at: nowIso(),
    ...extra,
  };
}

function socialOut(p: SocialPost): SocialPost {
  const a = articleById(p.article_id);
  return { ...clone(p), article: a ? { id: a.id, title: a.title, category: a.category, published_url: a.published_url, state: a.state } : null };
}

function postIssues(text: string, tags: string[]): string[] {
  const issues: string[] = [];
  if (text.length < 700) issues.push(`Shorter than the 700-character target (${text.length}); add one concrete number or implication.`);
  if (text.length > 1300) issues.push(`Longer than 1,300 characters (${text.length}); cut a paragraph.`);
  if (tags.length > 3) issues.push("More than 3 hashtags.");
  if (/\bdelve\b|game[- ]changer/i.test(text)) issues.push("Contains a banned phrase.");
  return issues;
}

function makePost(a: ArticleRec, at: string): SocialPost {
  const pb = playbook(a.category);
  const body = currentPayload(a).article;
  const link = a.published_url ?? `${SITE}${pb.route}/${a.slug ?? slugify(a.title)}`;
  const facts = a.facts.slice(0, 3);
  const sentences = (t: string | undefined, n: number) => (t ?? "").split(/(?<=[.!?])\s+/).slice(0, n).join(" ");
  const lede = sentences(body?.sections[0]?.paragraphs[0], 2) || a.title;
  const why = body?.sections.find((x) => x.key === "why_it_matters") ?? body?.sections[3] ?? body?.sections[1];
  const text = [
    a.dek,
    "",
    lede,
    "",
    "What stands out:",
    ...facts.map((f) => `→ ${f}`),
    "",
    sentences(why?.paragraphs[0], 2),
    "",
    body?.takeaway ?? "The useful question is not whether this matters, but which assumption in your own plan it tests.",
    "",
    `Full analysis: ${link}`,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  const hashtags = [pb.label.replace(/\s+/g, ""), "Leadership", "Strategy"].slice(0, 3);
  return {
    id: uid("sp-"),
    article_id: a.id,
    article: null,
    platform: "linkedin",
    text,
    hook: a.dek,
    cta: "Full analysis",
    link,
    hashtags,
    image_url: cardImage(a.title, pb.label, pb.color),
    image_spec: { width: 1200, height: 627, title: a.title, kicker: pb.label, brand: "The Executive Narrative" },
    status: "draft_ready",
    remote_urn: null,
    published_at: null,
    last_error: null,
    char_count: text.length,
    issues: postIssues(text, hashtags),
    created_at: at,
    updated_at: at,
  };
}

/* ====================================================================================== */
/* Helpers                                                                                */
/* ====================================================================================== */

function pageOf<T>(items: T[], query: Record<string, string>, def = 50): Paginated<T> {
  const page_size = Math.max(1, Number(query.page_size) || def);
  const page = Math.max(1, Number(query.page) || 1);
  return { items: items.slice((page - 1) * page_size, page * page_size), total: items.length, page, page_size };
}

function csv(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function conflict(code: string, message: string): never {
  throw new DemoError(409, code, message);
}

function invalid(message: string): never {
  throw new DemoError(422, "validation_error", message);
}

function requireArticle(id: string): ArticleRec {
  const a = articleById(id);
  if (!a) notFound("Article");
  return a;
}

function userActor(req: DemoRequest) {
  const u = owner(req);
  return { type: "user" as const, id: u.id, label: u.name };
}

function cadence(req: DemoRequest): Cadence {
  return ws(req).settings.cadence;
}

function tzOf(req: DemoRequest): string {
  return ws(req).tenant.timezone || "UTC";
}

function nextSlot(req: DemoRequest, category: Category, pubs: Publication[]): { at: string; reason: string } {
  const cad = cadence(req);
  const tz = tzOf(req);
  const taken = pubs.filter((p) => ["scheduled", "publishing", "published"].includes(p.status));
  const catOf = (p: Publication) => articleById(p.article_id)?.category;
  for (let d = 0; d < 30; d++) {
    const key = dayKey(new Date(Date.now() + d * 86_400_000), tz);
    const [y, m, dd] = key.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
    if (cad.weekdays_only && (wd === 0 || wd === 6)) continue;
    const dayPubs = taken.filter((p) => {
      const w = pubWhen(p);
      return w ? dayKey(w, tz) === key : false;
    });
    if (dayPubs.length >= cad.per_day) continue;
    if (dayPubs.filter((p) => catOf(p) === category).length >= cad.max_per_category_per_day) continue;
    for (const slot of cad.slots) {
      const at = fromLocalInput(`${key}T${slot}`, tz);
      if (Date.parse(at) < Date.now() + 10 * 60_000) continue;
      if (dayPubs.some((p) => Math.abs(Date.parse(pubWhen(p) ?? "") - Date.parse(at)) < 60_000)) continue;
      const dayName = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, dd)));
      return { at, reason: `${d === 0 ? "Today" : dayName} ${slot} is the next free cadence slot (${dayPubs.length}/${cad.per_day} used that day, ≤${cad.max_per_category_per_day} ${playbook(category).label} per day)` };
    }
  }
  return { at: daysAhead(1), reason: "No free cadence slot in the next 30 days; defaulted to tomorrow" };
}

function conflictsFor(req: DemoRequest, pubs: Publication[]): CalendarConflict[] {
  const cad = cadence(req);
  const tz = tzOf(req);
  const byDay: Record<string, Publication[]> = {};
  for (const p of pubs) {
    if (!["scheduled", "publishing", "published"].includes(p.status)) continue;
    const w = pubWhen(p);
    if (w) (byDay[dayKey(w, tz)] ??= []).push(p);
  }
  const out: CalendarConflict[] = [];
  for (const [date, list] of Object.entries(byDay)) {
    if (list.length > cad.per_day) out.push({ date, kind: "per_day", message: `${date}: ${list.length} publications (cadence ${cad.per_day}/day)`, ids: list.map((p) => p.id) });
    const cats: Record<string, Publication[]> = {};
    for (const p of list) (cats[articleById(p.article_id)?.category ?? "?"] ??= []).push(p);
    for (const [c, l] of Object.entries(cats)) {
      if (l.length > cad.max_per_category_per_day) out.push({ date, kind: "category", message: `${date}: ${l.length} ${playbook(c).label} pieces (max ${cad.max_per_category_per_day})`, ids: l.map((p) => p.id) });
    }
  }
  return out;
}

/* ====================================================================================== */
/* Health + dashboard                                                                     */
/* ====================================================================================== */

function modelHealth(req: DemoRequest): ModelHealth {
  const configured = Array.from(new Set(Object.values(ws(req).models).map((m) => m.model).filter(Boolean) as string[]));
  return {
    status: "ok",
    provider: "ollama",
    base_url: "http://ollama:11434",
    models: ["qwen2.5:14b-instruct", "llama3.2:3b", "nomic-embed-text"],
    configured: [...configured, "nomic-embed-text"],
    missing: [],
    latency_ms: 38,
    detail: null,
    is_mock: false,
  };
}

function workerHealth(): WorkerHealth {
  const running = jobs.filter((r) => r.job.status === "running");
  return { status: "ok", last_seen: iso(Date.now() - 4000), age_s: 4, workers: 1, running: Object.fromEntries(running.map((r) => [r.job.id, r.job.type])) };
}

function health(req: DemoRequest): Health {
  const srcs = ws(req).sources;
  return {
    status: "ok",
    checks: {
      database: { status: "ok", latency_ms: 2, backend: "postgresql" },
      model: modelHealth(req),
      worker: workerHealth(),
      disk: { status: "ok", total_gb: 512, free_gb: 318.4, used_pct: 37.8 },
      discovery: { status: "ok", last_run_at: news?.lastDiscoveryAt ?? minutesAgo(18), age_h: 0.3, last_new_items: 14, sources_ok: srcs.filter((s) => s.active && !s.last_error).length },
    },
    version: "1.0.0",
    time: nowIso(),
  };
}

function dashboardSummary(req: DemoRequest): DashboardSummary {
  const isTen = (req.workspace || TEN) === TEN;
  const store = isTen ? tenStore(req) : null;
  const arts = store?.articles ?? [];
  const pubs = store?.pubs ?? [];
  const wsJobs = jobs.filter((r) => r.ws === (req.workspace || TEN)).map((r) => r.job);
  const states: Record<string, number> = {};
  for (const a of arts) states[a.state] = (states[a.state] ?? 0) + 1;
  const count = (list: string[]) => arts.filter((a) => list.includes(a.state)).length;
  const dayMs = 86_400_000;
  const feedToday = (store?.feed ?? []).filter((f) => ["new", "triaged"].includes(f.status) && Date.parse(f.fetched_at ?? "") > Date.now() - dayMs).length;
  const r = seeded(`daily-${req.workspace}`);
  const daily = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * dayMs);
    const date = d.toISOString().slice(0, 10);
    const published = pubs.filter((p) => p.status === "published" && (p.published_at ?? "").slice(0, 10) === date).length;
    return isTen ? { date, discovered: 22 + Math.floor(r() * 30), drafted: 1 + Math.floor(r() * 3), published } : { date, discovered: 0, drafted: 0, published: 0 };
  });
  const queued = wsJobs.filter((j) => j.status === "queued");
  const failed = wsJobs.filter((j) => j.status === "failed" || j.status === "dead");
  const lastOf = (types: string[]) =>
    wsJobs
      .filter((j) => types.includes(j.type))
      .map((j) => j.finished_at ?? j.started_at ?? j.created_at ?? "")
      .sort()
      .pop() ?? null;
  const agentDefs: [string, string, string, string[]][] = [
    ["A1", "discovery", "Discovery", ["discover"]],
    ["A2", "research", "Research", ["research"]],
    ["A3", "writer", "Writer", ["write"]],
    ["A4", "editor", "Editor", ["edit"]],
    ["A5", "seo", "SEO", ["seo"]],
    ["A6", "critic", "Critic (QA)", ["qa"]],
    ["A7", "publisher", "Publisher", ["publish"]],
    ["A8", "crawler", "Site & competitor crawl", ["crawl_inventory", "crawl_competitors"]],
    ["A9", "linkedin", "LinkedIn", ["social", "distribute"]],
  ];
  const rr = seeded(`agents-${req.workspace}`);
  const agents: AgentHealthRow[] = agentDefs.map(([code, agent, label, types]) => {
    const mine = wsJobs.filter((j) => types.includes(j.type) && Date.parse(j.created_at ?? "") > Date.now() - dayMs);
    const errs = mine.filter((j) => j.status === "failed" || j.status === "dead");
    const lastErr = wsJobs.filter((j) => types.includes(j.type) && j.last_error).pop()?.last_error ?? null;
    const p50 = isTen ? Math.round(800 + rr() * 9000) : null;
    return {
      code,
      agent,
      label,
      jobs_24h: mine.length,
      model_calls_24h: ["publisher", "crawler"].includes(agent) ? 0 : mine.length * (agent === "writer" ? 7 : 2),
      errors_24h: errs.length,
      p50_latency_ms: mine.length || isTen ? p50 : null,
      p95_latency_ms: p50 ? Math.round(p50 * 2.4) : null,
      avg_job_ms: mine.length ? Math.round(mine.reduce((s, j) => s + (j.duration_ms ?? 0), 0) / mine.length) : null,
      last_run_at: lastOf(types),
      last_error: errs.length ? lastErr : null,
    };
  });
  return {
    cards: {
      candidates_today: feedToday,
      drafts_in_progress: count(["queued", "researching", "drafting", "editing", "seo", "qa"]),
      awaiting_review: count(["in_review"]),
      scheduled: pubs.filter((p) => p.status === "scheduled").length,
      published_7d: pubs.filter((p) => p.status === "published" && Date.parse(p.published_at ?? "") > Date.now() - 7 * dayMs).length,
      failed_jobs: failed.length,
    },
    states,
    funnel: isTen
      ? [
          { stage: "discovered", label: "Discovered", count: daily.reduce((s, d) => s + d.discovered, 0) },
          { stage: "candidates", label: "Unique candidates", count: Math.round(daily.reduce((s, d) => s + d.discovered, 0) * 0.62) },
          { stage: "promoted", label: "Promoted", count: arts.length },
          { stage: "drafted", label: "Drafted", count: arts.filter((a) => a.versions.length).length },
          { stage: "approved", label: "Approved", count: count(["approved", "scheduled", "publishing", "published"]) },
          { stage: "published", label: "Published", count: count(["published"]) },
        ]
      : [
          { stage: "discovered", label: "Discovered", count: 0 },
          { stage: "published", label: "Published", count: 0 },
        ],
    daily,
    queue: {
      queued: queued.length,
      running: wsJobs.filter((j) => j.status === "running").length,
      done: wsJobs.filter((j) => j.status === "done").length,
      failed: wsJobs.filter((j) => j.status === "failed").length,
      dead: wsJobs.filter((j) => j.status === "dead").length,
      retrying: 0,
      failed_24h: failed.filter((j) => Date.parse(j.finished_at ?? "") > Date.now() - dayMs).length,
      oldest_queued_age_s: queued.length ? Math.round((Date.now() - Math.min(...queued.map((j) => Date.parse(j.created_at ?? "")))) / 1000) : null,
    },
    agents,
    model: modelHealth(req),
    worker: workerHealth(),
    generated_at: nowIso(),
  };
}

/* ====================================================================================== */
/* Route handlers                                                                         */
/* ====================================================================================== */

type R = DemoRequest;

function handleJobs(req: R): unknown {
  const [, id, action] = req.segments;
  const mine = (r: JobRec) => r.ws === (req.workspace || TEN);
  if (!id && req.method === "GET") {
    const statuses = csv(req.query.status);
    const types = csv(req.query.type);
    const list = jobs
      .filter(mine)
      .map((r) => r.job)
      .filter((j) => (!statuses.length || statuses.includes(j.status)) && (!types.length || types.includes(j.type)) && (!req.query.article_id || j.article_id === req.query.article_id))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
      .map(jobOut);
    return pageOf(list, req.query, 50);
  }
  const rec = jobs.find((r) => r.job.id === id && mine(r));
  if (!rec) notFound("Job");
  if (!action && req.method === "GET") return { job: jobOut(rec.job), events: events.filter((e) => e.job_id === id).map((e) => ({ ...e })) };
  if (action === "retry" && req.method === "POST") {
    if (rec.job.status === "queued" || rec.job.status === "running") conflict("job_active", "Job is still running");
    const remaining = rec.stages.length > 1 ? rec.stages.slice(Math.max(0, rec.finished)) : rec.stages;
    const job = createJob(req, rec.job.type, { article_id: rec.job.article_id, stages: remaining.length ? remaining : rec.stages, ctx: { ...rec.ctx } });
    return { job };
  }
  return UNHANDLED;
}

/* ---------- Feed ---------- */

function handleFeed(req: R, isTen: boolean): unknown {
  const [, id, action] = req.segments;
  if (!id && req.method === "GET") {
    if (!isTen) return { items: [], total: 0, page: 1, page_size: Number(req.query.page_size) || 50, last_fetched_at: null, stale: false } satisfies FeedList;
    const store = tenStore(req);
    const q = (req.query.q ?? "").toLowerCase();
    const status = req.query.status ?? "";
    const minScore = Number(req.query.min_score) || 0;
    let items = store.feed.filter((f) => {
      if (status && status !== "all" ? f.status !== status : !status && !["new", "triaged", "promoted"].includes(f.status)) return false;
      if (status !== "duplicate" && status !== "all" && !f.is_cluster_head) return false;
      if (req.query.category && f.suggested_category !== req.query.category) return false;
      if (req.query.region && f.region !== req.query.region) return false;
      if (req.query.source_id && f.source?.id !== req.query.source_id) return false;
      if (minScore && f.score < minScore) return false;
      if (q && ![f.title, f.summary ?? "", f.publisher ?? ""].some((s) => s.toLowerCase().includes(q))) return false;
      return true;
    });
    const sort = req.query.sort ?? "score";
    items = items.slice().sort((a, b) => (sort === "published" ? (b.published_at ?? "").localeCompare(a.published_at ?? "") : sort === "fetched" ? (b.fetched_at ?? "").localeCompare(a.fetched_at ?? "") : b.score - a.score));
    const last = store.feed.map((f) => f.fetched_at ?? "").sort().pop() ?? null;
    return { ...pageOf(clone(items), req.query, 50), last_fetched_at: last, stale: false } satisfies FeedList;
  }
  if (id === "refresh" && req.method === "POST") return { job: createJob(req, "discover", { stageMs: 3200 }) };
  if (id === "promote-bulk" && req.method === "POST") {
    if (!isTen) return { results: [], promoted: 0 };
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const results = ids.map((fid) => {
      try {
        const item = tenStore(req).feed.find((f) => f.id === fid);
        if (!item) return { id: fid, ok: false, error: "Not found" };
        promote(req, item, { category: item.suggested_category ?? "brief", angle: item.why_it_matters ?? undefined, auto: req.body?.auto !== false });
        return { id: fid, ok: true };
      } catch (e) {
        return { id: fid, ok: false, error: e instanceof Error ? e.message : "Failed" };
      }
    });
    return { results, promoted: results.filter((r) => r.ok).length };
  }
  if (!isTen) notFound("Feed item");
  const store = tenStore(req);
  const item = store.feed.find((f) => f.id === id);
  if (!item) notFound("Feed item");
  if (!action && req.method === "GET") {
    const cluster = item.dedupe_cluster_id ? store.feed.filter((f) => f.id !== item.id && f.dedupe_cluster_id === item.dedupe_cluster_id) : [];
    const similar = store.feed
      .filter((f) => f.id !== item.id && f.suggested_category === item.suggested_category && f.dedupe_cluster_id !== item.dedupe_cluster_id && f.status !== "ignored")
      .slice(0, 3)
      .map((f, i) => ({ ...clone(f), similarity: Math.round((0.48 - i * 0.07) * 100) / 100 }));
    const topic = store.topics.find((t) => t.id === item.topic_id) ?? null;
    return { item: clone(item), cluster: clone(cluster), similar, topic: clone(topic), article_id: item.article_id } satisfies FeedDetail;
  }
  if (action === "promote" && req.method === "POST") {
    const body = req.body ?? {};
    return promote(req, item, { category: (body.category as Category) ?? item.suggested_category ?? "brief", angle: body.angle, auto: body.auto !== false });
  }
  if (action === "ignore" && req.method === "POST") {
    if (item.status === "promoted") conflict("already_promoted", "Promoted stories cannot be ignored");
    item.status = "ignored";
    item.ignored_reason = String(req.body?.reason ?? "Ignored");
    addAudit({ actor_type: "user", actor_id: owner(req).id, actor_label: owner(req).name, action: "feed.ignore", entity: "feed", entity_id: item.id, detail: { reason: item.ignored_reason }, entity_label: item.title });
    return clone(item);
  }
  if (action === "restore" && req.method === "POST") {
    if (item.status === "ignored") item.status = "new";
    item.ignored_reason = null;
    return clone(item);
  }
  return UNHANDLED;
}

function newArticle(req: R, o: { title: string; category: Category; angle: string | null; region: Region | null; feed: FeedItem | null; notes?: string | null; links?: string[] }): { topic: Topic; article: ArticleRec } {
  const store = tenStore(req);
  const at = nowIso();
  const topic: Topic = { id: uid("tpc-"), feed_item_id: o.feed?.id ?? null, category: o.category, title: o.title, angle: o.angle, region: o.region, notes: o.notes ?? null, links: o.links ?? [], status: "in_progress", created_at: at };
  store.topics.push(topic);
  const meta = o.feed ? store.facts[o.feed.id] : undefined;
  const facts = meta?.facts.length ? meta.facts : [o.feed?.summary ?? `${o.title}.`, ...(o.notes ? [o.notes.split(/(?<=\.)\s+/)[0]] : []), ...(o.links ?? []).slice(0, 2).map((l) => `Supplied source: ${l}`)].filter(Boolean);
  const subject = meta?.subject ?? (o.title.length > 48 ? "this decision" : o.title.replace(/[.?!]$/, "").toLowerCase());
  const title = o.title;
  const a: ArticleRec = {
    id: uid("art-"),
    title,
    dek: o.feed?.why_it_matters ?? o.angle ?? "What it means, who has to respond and what to watch next.",
    category: o.category,
    state: "queued",
    slug: null,
    revision_count: 0,
    last_error: null,
    published_url: null,
    topic_id: topic.id,
    feed_id: o.feed?.id ?? null,
    created_at: at,
    updated_at: at,
    versions: [],
    current_version_id: null,
    research_pack: null,
    review_actions: [],
    subject,
    facts,
    keyword: slugify(title).split("-").slice(0, 3).join(" "),
    secondary: o.feed?.entities.slice(0, 3).map((e) => e.name.toLowerCase()) ?? [o.category.replace("_", " ")],
    clean: null,
    thin: false,
    seed: store.articles.length * 5 + 1,
  };
  store.articles.push(a);
  return { topic, article: a };
}

function promote(req: R, item: FeedItem, o: { category: Category; angle?: string; auto: boolean }) {
  if (item.article_id) conflict("already_promoted", "This story is already in the studio");
  if (item.status === "ignored") conflict("ignored", "Restore the story first");
  const { topic, article } = newArticle(req, { title: item.title, category: o.category, angle: o.angle ?? item.why_it_matters, region: item.region, feed: item });
  item.status = "promoted";
  item.topic_id = topic.id;
  item.article_id = article.id;
  addAudit({ actor_type: "user", actor_id: owner(req).id, actor_label: owner(req).name, action: "feed.promote", entity: "article", entity_id: article.id, detail: { category: o.category }, entity_label: article.title });
  const job = createJob(req, "research", { article_id: article.id, stages: o.auto ? [...STAGE_ORDER] : ["research"] });
  return { topic: clone(topic), article: summary(article), job };
}

/* ---------- Sources ---------- */

function handleSources(req: R): unknown {
  const state = ws(req);
  const [, id, action] = req.segments;
  if (!id && req.method === "GET") return { items: clone(state.sources) };
  if (!id && req.method === "POST") {
    const b = req.body ?? {};
    if (!/^https?:\/\//.test(String(b.url ?? ""))) invalid("Enter an http(s) URL");
    const s: Source = {
      id: uid("src-"),
      kind: (b.kind as SourceKind) ?? "rss",
      name: String(b.name ?? "New source"),
      url: String(b.url),
      weight: Number(b.weight) || 1,
      region: (b.region as Region) ?? null,
      group: "custom",
      tier: null,
      active: b.active !== false,
      last_fetched_at: null,
      last_error: null,
      consecutive_failures: 0,
      last_item_count: null,
      last_latency_ms: null,
      items_7d: 0,
      created_at: nowIso(),
    };
    state.sources.push(s);
    return clone(s);
  }
  const src = state.sources.find((s) => s.id === id);
  if (!src) notFound("Source");
  if (!action && req.method === "PATCH") {
    const b = req.body ?? {};
    for (const k of ["kind", "name", "url", "region", "active"] as const) if (k in b) (src as unknown as Record<string, unknown>)[k] = b[k];
    if ("weight" in b) src.weight = Number(b.weight) || src.weight;
    if (b.active === true && src.consecutive_failures >= 5) src.consecutive_failures = 0;
    return clone(src);
  }
  if (!action && req.method === "DELETE") {
    state.sources.splice(state.sources.indexOf(src), 1);
    return { ok: true };
  }
  if (action === "test" && req.method === "POST") {
    const latency = 180 + (src.name.length * 37) % 900;
    src.last_latency_ms = latency;
    if (src.last_error) return { ok: false, item_count: 0, latency_ms: latency, error: src.last_error, sample: [] };
    const fromFeed = (news?.feed ?? []).filter((f) => f.source?.id === src.id).slice(0, 3);
    const sample = (fromFeed.length ? fromFeed : FEED_SPECS.slice(2, 5).map(feedItem)).map((f) => ({ title: f.title, url: f.url, published_at: f.published_at, image_url: null }));
    src.last_fetched_at = nowIso();
    src.last_item_count = 18 + (src.name.length % 15);
    return { ok: true, item_count: src.last_item_count, latency_ms: latency, error: null, sample };
  }
  return UNHANDLED;
}

/* ---------- Articles ---------- */

function handleArticles(req: R, isTen: boolean): unknown {
  const [, id, action, sub, subAction] = req.segments;
  if (!id && req.method === "GET") {
    if (!isTen) return { items: [], total: 0, page: 1, page_size: Number(req.query.page_size) || 50 } satisfies Paginated<ArticleSummary>;
    const store = tenStore(req);
    const states = csv(req.query.state);
    const q = (req.query.q ?? "").toLowerCase();
    const list = store.articles
      .filter((a) => (!states.length || states.includes(a.state)) && (!req.query.category || a.category === req.query.category) && (!q || a.title.toLowerCase().includes(q) || (a.slug ?? "").includes(q)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(summary);
    return pageOf(list, req.query, 50);
  }
  if (!isTen) notFound("Article");
  tenStore(req);
  const a = requireArticle(id);
  const actor = userActor(req);
  const me = owner(req);
  const busy = () => Boolean(activeJob(a.id));
  const reviewAction = (kind: ReviewActionOut["action"], reason: string | null) => {
    a.review_actions.unshift({ id: uid("ra-"), action: kind, reason, user: me, created_at: nowIso() });
  };

  if (!action) {
    if (req.method === "GET") return detail(a);
    if (req.method === "PATCH") {
      if (!EDITABLE_STATES.has(a.state) || busy()) conflict("not_editable", `Editing is not allowed while the article is ${a.state}`);
      const b = req.body ?? {};
      const prev = currentPayload(a);
      const base = prev.article ?? a.clean ?? bodyFor(a);
      const body: ArticleBody = {
        ...clone(base),
        title: b.title ?? base.title,
        dek: b.dek ?? base.dek,
        takeaway: b.takeaway ?? base.takeaway,
        sections: Array.isArray(b.sections) ? (b.sections as Section[]) : base.sections,
      };
      body.word_count = wordCount(articleText({ ...body, title: "", dek: "" }));
      a.title = body.title;
      a.dek = body.dek;
      a.clean = clone(body);
      addVersion(a, "human", { article: body, stats: computeStats(body, a.seed), seo: prev.seo ?? null, editor: prev.editor ?? null }, nowIso(), b.note ?? "Edited in the studio", me.name);
      if (["qa", "in_review", "approved", "published", "failed"].includes(a.state)) {
        moveState(a, "qa", actor, "edited after QA");
        createJob(req, "qa", { article_id: a.id, stages: ["qa"] });
      }
      return detail(a);
    }
    return UNHANDLED;
  }

  if (req.method === "GET") {
    if (action === "versions") return { items: clone(a.versions), current_version_id: a.current_version_id };
    if (action === "logs") {
      const after = Number(req.query.after) || 0;
      return { items: events.filter((e) => e.article_id === a.id && e.id > after).map((e) => ({ ...e })) };
    }
    if (action === "preview") {
      const p = currentPayload(a);
      const html = renderArticleHtml(p.article, { seo: p.seo, tenantName: ws(req).tenant.name });
      return req.text ? html : { html };
    }
    if (action === "events") throw new DemoError(501, "demo_unavailable", DEMO_UNAVAILABLE);
    return UNHANDLED;
  }
  if (req.method !== "POST") return UNHANDLED;
  const reason = typeof req.body?.reason === "string" ? req.body.reason : null;

  switch (action) {
    case "run": {
      const stage = String(req.body?.stage ?? "auto");
      const runnable = runnableStages(a.state, busy());
      if (busy()) conflict("busy", "The article already has a running job");
      if (stage === "auto") {
        if (!runnable.includes("research")) conflict("illegal_transition", `Cannot run the pipeline from ${a.state}`);
        return { job: createJob(req, "research", { article_id: a.id, stages: [...STAGE_ORDER] }) };
      }
      if (!runnable.includes(stage)) conflict("illegal_transition", `Cannot run ${stage} while the article is ${a.state}`);
      return { job: createJob(req, stage, { article_id: a.id, stages: [stage] }) };
    }
    case "revise": {
      const stage = String(req.body?.stage ?? "write");
      if (busy()) conflict("busy", "The article already has a running job");
      if (!runnableStages(a.state, false).includes(stage)) conflict("illegal_transition", `Cannot revise from ${a.state}`);
      a.revision_count += 1;
      const stages = STAGE_ORDER.slice(STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]));
      return { job: createJob(req, stage, { article_id: a.id, stages, ctx: { instruction: String(req.body?.instruction ?? "") } }) };
    }
    case "approve":
      if (a.state !== "in_review" || busy()) conflict("illegal_transition", `Cannot approve while ${a.state}`);
      reviewAction("approve", null);
      moveState(a, "approved", actor);
      addAudit({ actor_type: "user", actor_id: me.id, actor_label: me.name, action: "review.approve", entity: "article", entity_id: a.id, detail: {}, entity_label: a.title });
      return detail(a);
    case "reject":
      if (!["in_review", "approved", "failed", "needs_sources", "queued"].includes(a.state)) conflict("illegal_transition", `Cannot reject while ${a.state}`);
      reviewAction("reject", reason);
      moveState(a, "archived", actor, reason ?? undefined);
      addAudit({ actor_type: "user", actor_id: me.id, actor_label: me.name, action: "review.reject", entity: "article", entity_id: a.id, detail: { reason }, entity_label: a.title });
      return detail(a);
    case "request-revision": {
      if (!["in_review", "approved"].includes(a.state) || busy()) conflict("illegal_transition", `Cannot request a revision while ${a.state}`);
      const stage = req.body?.stage === "edit" ? "edit" : "write";
      reviewAction("request_revision", reason);
      a.revision_count += 1;
      addAudit({ actor_type: "user", actor_id: me.id, actor_label: me.name, action: "review.request_revision", entity: "article", entity_id: a.id, detail: { reason, stage }, entity_label: a.title });
      const job = createJob(req, stage, { article_id: a.id, stages: STAGE_ORDER.slice(STAGE_ORDER.indexOf(stage)), ctx: { instruction: reason ?? undefined } });
      return { ...detail(a), job };
    }
    case "force-review":
      if (!["failed", "qa"].includes(a.state)) conflict("illegal_transition", `Cannot force review while ${a.state}`);
      reviewAction("force_review", reason);
      moveState(a, "in_review", actor, `override: ${reason ?? ""}`);
      return detail(a);
    case "archive":
      if (["scheduled", "publishing", "published"].includes(a.state)) conflict("illegal_transition", "Cancel or roll back the publication first");
      moveState(a, "archived", actor);
      return detail(a);
    case "versions": {
      if (subAction !== "restore") return UNHANDLED;
      const v = a.versions.find((x) => x.id === sub);
      if (!v) notFound("Version");
      if (busy() || ["scheduled", "publishing"].includes(a.state)) conflict("illegal_transition", "Restoring is not allowed in this state");
      const payload = clone(v.payload ?? {});
      // An older content version keeps the current (now stale) SEO so search metadata never disappears.
      if (!payload.seo) payload.seo = clone(currentPayload(a).seo ?? null);
      if (payload.article) {
        a.clean = clone(payload.article);
        a.title = payload.article.title;
      }
      addVersion(a, v.stage, payload, nowIso(), `Restored from the ${v.stage} version of ${new Date(v.created_at ?? Date.now()).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, me.name);
      return detail(a);
    }
    default:
      return UNHANDLED;
  }
}

function handleTopics(req: R, isTen: boolean): unknown {
  if (req.segments.length !== 1 || req.method !== "POST") return UNHANDLED;
  if (!isTen) throw new DemoError(403, "forbidden", "Topics are only available in the newsroom workspace");
  const b = req.body ?? {};
  const title = String(b.title ?? "").trim();
  if (title.length < 8) invalid("Title needs at least 8 characters");
  const { topic, article } = newArticle(req, { title, category: (b.category as Category) ?? "brief", angle: b.angle ?? null, region: (b.region as Region) ?? "global", feed: null, notes: b.notes ?? null, links: Array.isArray(b.links) ? b.links : [] });
  addAudit({ actor_type: "user", actor_id: owner(req).id, actor_label: owner(req).name, action: "topic.create", entity: "article", entity_id: article.id, detail: { category: article.category }, entity_label: article.title });
  const job = createJob(req, "research", { article_id: article.id, stages: b.auto === false ? ["research"] : [...STAGE_ORDER] });
  return { topic: clone(topic), article: summary(article), job };
}

/* ---------- Publications ---------- */

function handlePublications(req: R, isTen: boolean): unknown {
  const [, id, action] = req.segments;
  const state = ws(req);
  if (id === "next-slot" && req.method === "GET") {
    const slot = nextSlot(req, (req.query.category as Category) ?? "brief", isTen ? tenStore(req).pubs : []);
    return { scheduled_at: slot.at, reason: slot.reason, timezone: tzOf(req), default_target: state.integrations.default_target };
  }
  if (!id && req.method === "GET") {
    if (!isTen) return { items: [], conflicts: [], timezone: tzOf(req), cadence: clone(cadence(req)) };
    const store = tenStore(req);
    const start = req.query.start ? Date.parse(req.query.start) : -Infinity;
    const end = req.query.end ? Date.parse(req.query.end) : Infinity;
    const items = store.pubs.filter((p) => {
      const w = Date.parse(pubWhen(p) ?? "");
      return !Number.isNaN(w) && w >= start && w <= end;
    });
    return { items: items.map(pubOut), conflicts: conflictsFor(req, items), timezone: tzOf(req), cadence: clone(cadence(req)) };
  }
  if (!isTen) notFound("Publication");
  const store = tenStore(req);
  const actor = userActor(req);
  if (id === "dry-run" && req.method === "POST") {
    const a = requireArticle(String(req.body?.article_id ?? ""));
    const target = (req.body?.target as PublishTarget) ?? state.integrations.default_target;
    const p = currentPayload(a);
    const live = target === "export" ? null : `${SITE}${playbook(a.category).route}/${p.seo?.slug ?? a.slug ?? slugify(a.title)}`;
    const existing = store.pubs.find((x) => x.article_id === a.id && x.status === "published");
    const issues: string[] = [];
    if (!p.seo) issues.push("SEO metadata missing: run SEO first");
    if (!p.qa) issues.push("QA has not run on this version");
    if (target === "wordpress" && !state.integrations.targets.wordpress.configured) issues.push("WordPress is not configured");
    const hash = slugify(`${a.id}${a.current_version_id}`).replace(/-/g, "");
    const dry: DryRun = {
      target,
      html: renderArticleHtml(p.article, { seo: p.seo, tenantName: state.tenant.name }),
      issues,
      files: target === "export" ? ["index.html", "article.md", "meta.json", "schema.json"] : ["index.html", "schema.json", "sitemap.xml (entry)", "export bundle (backup)"],
      live_url: live,
      content_hash: `sha256:${hash.slice(0, 40)}`,
      idempotency_key: `${hash}${target}`.padEnd(40, "0"),
      will_update: Boolean(existing),
      existing_live_url: existing?.live_url ?? null,
      unchanged: Boolean(existing && existing.version_id === a.current_version_id),
      preview: { title: p.seo?.title_tag ?? a.title, description: p.seo?.meta_description ?? null, canonical: p.seo?.canonical_url ?? live },
    };
    return dry;
  }
  if (!id && req.method === "POST") {
    const a = requireArticle(String(req.body?.article_id ?? ""));
    const target = (req.body?.target as PublishTarget) ?? state.integrations.default_target;
    const dup = store.pubs.find((p) => p.article_id === a.id && p.version_id === a.current_version_id && p.target === target && ["scheduled", "published"].includes(p.status));
    if (dup) return { ...pubOut(dup), idempotent: true, reason: "This exact version is already scheduled or published" };
    if (!["approved", "published"].includes(a.state) || activeJob(a.id)) conflict("illegal_transition", `Only approved articles can be scheduled (article is ${a.state})`);
    const slot = req.body?.scheduled_at ? { at: String(req.body.scheduled_at), reason: "Chosen by reviewer" } : nextSlot(req, a.category, store.pubs);
    const pub = newPublication(a, target, slot.at);
    store.pubs.push(pub);
    pub.warnings = conflictsFor(req, store.pubs).filter((c) => c.ids.includes(pub.id)).map((c) => c.message);
    moveState(a, "scheduled", actor, `scheduled for ${slot.at} → ${target}`);
    return { ...pubOut(pub), reason: slot.reason };
  }
  const p = store.pubs.find((x) => x.id === id);
  if (!p) notFound("Publication");
  const a = articleById(p.article_id);
  if (!action && req.method === "PATCH") {
    const b = req.body ?? {};
    if (b.status === "cancelled") {
      if (!["scheduled", "failed"].includes(p.status)) conflict("illegal_transition", `Publication is ${p.status}`);
      p.status = "cancelled";
      if (a && a.state === "scheduled") moveState(a, "approved", actor, "publication cancelled");
    }
    if (b.scheduled_at) {
      if (!["scheduled", "failed"].includes(p.status)) conflict("illegal_transition", `Publication is ${p.status}`);
      if (Date.parse(b.scheduled_at) < Date.now()) invalid("Cannot schedule in the past");
      p.scheduled_at = String(b.scheduled_at);
      if (p.status === "failed") {
        p.status = "scheduled";
        p.last_error = null;
        if (a) moveState(a, "scheduled", actor, "rescheduled after failure");
      }
      p.warnings = conflictsFor(req, store.pubs).filter((c) => c.ids.includes(p.id)).map((c) => c.message);
    }
    return pubOut(p);
  }
  if (action === "publish-now" && req.method === "POST") {
    if (p.status === "published") return { publication: pubOut(p), job: null };
    if (!["scheduled", "failed"].includes(p.status)) conflict("illegal_transition", `Publication is ${p.status}`);
    p.status = "publishing";
    p.scheduled_at = nowIso();
    if (a) moveState(a, "publishing", actor, "publish now");
    const job = createJob(req, "publish", { article_id: p.article_id, ctx: { pub_id: p.id }, stageMs: 2400 });
    return { publication: pubOut(p), job };
  }
  if (action === "rollback" && req.method === "POST") {
    if (p.status !== "published") conflict("illegal_transition", "Only published pages can be rolled back");
    p.status = "rolled_back";
    if (a) {
      a.published_url = null;
      moveState(a, "approved", actor, "rolled back");
    }
    addAudit({ actor_type: "user", actor_id: actor.id, actor_label: actor.label, action: "publication.rollback", entity: "article", entity_id: p.article_id, detail: { target: p.target }, entity_label: a?.title ?? null });
    return pubOut(p);
  }
  if (action === "artifact") throw new DemoError(501, "demo_unavailable", DEMO_UNAVAILABLE);
  return UNHANDLED;
}

/* ---------- Social ---------- */

function connection(req: R): SocialConnection {
  const li = ws(req).integrations.linkedin;
  return {
    configured: li.client_id_set && li.client_secret_set,
    connected: li.connected,
    author_urn: li.author_urn,
    author_type: li.author_type,
    expires_at: li.expires_at,
    reason: li.connected ? null : "No LinkedIn access token: connect in Settings → Integrations.",
  };
}

function handleSocial(req: R, isTen: boolean): unknown {
  const [, id, action] = req.segments;
  if (!id && req.method === "GET") {
    if (!isTen) return { items: [], connection: connection(req), articles_without_post: [] };
    const store = tenStore(req);
    const withPost = new Set(store.social.map((p) => p.article_id));
    return {
      items: store.social.map(socialOut).sort((x, y) => (y.created_at ?? "").localeCompare(x.created_at ?? "")),
      connection: connection(req),
      articles_without_post: store.articles
        .filter((a) => ["approved", "scheduled", "published"].includes(a.state) && !withPost.has(a.id))
        .map((a) => ({ id: a.id, title: a.title, category: a.category, state: a.state })),
    };
  }
  if (!isTen) notFound("Post");
  const store = tenStore(req);
  if (action === "generate" && req.method === "POST") {
    const a = requireArticle(id);
    return { job: createJob(req, "social", { article_id: a.id, stageMs: 2600 }) };
  }
  const post = store.social.find((p) => p.id === id);
  if (!post) notFound("Post");
  if (!action && req.method === "PATCH") {
    if (post.status === "published" || post.status === "publishing") conflict("already_published", "Already posted");
    const b = req.body ?? {};
    if (typeof b.text === "string") post.text = b.text;
    if (Array.isArray(b.hashtags)) post.hashtags = b.hashtags.slice(0, 3);
    if (b.status === "approved" || b.status === "draft_ready") post.status = b.status;
    post.char_count = post.text.length;
    post.issues = postIssues(post.text, post.hashtags);
    post.updated_at = nowIso();
    return socialOut(post);
  }
  if (action === "publish" && req.method === "POST") {
    if (post.status === "published") return { post: socialOut(post), job: null };
    if (!ws(req).integrations.linkedin.connected) throw new DemoError(409, "linkedin_not_connected", "LinkedIn is not connected");
    post.status = "publishing";
    post.updated_at = nowIso();
    const job = createJob(req, "distribute", { article_id: post.article_id, ctx: { post_id: post.id }, stageMs: 2200 });
    return { post: socialOut(post), job };
  }
  if (action === "copied" && req.method === "POST") return { ok: true };
  return UNHANDLED;
}

/* ---------- SEO ---------- */

const INVENTORY: [string, string | null, number, boolean, number | null][] = [
  ["/", "The Executive Narrative — Analysis for senior leaders", 200, true, 640],
  ["/brief", "Brief", 200, false, 220],
  ["/thinking", "Thinking", 200, false, 210],
  ["/descisions", "Decisions", 200, false, 190],
  ["/deep_dive", "Deep Dive", 200, false, 205],
  ["/brief/why-capex-cycles-outlast-their-ceos", "Why capex cycles outlast their CEOs", 200, false, 980],
  ["/deep_dive/the-economics-of-second-sourcing", "The economics of second-sourcing", 200, false, 1720],
  ["/thinking/optionality-is-a-budget-line", "Optionality is a budget line, not a mindset", 200, true, 520],
  ["/brief/meridian-arcturus-embedded-lending", "Meridian's $1.1bn Arcturus deal is a bet on embedded lending", 200, true, 470],
  ["/playbook/board-ready-ai-policy", null, 200, false, 1310],
  ["/room/inside-a-pricing-war-room", "Inside a pricing war room", 200, false, 1180],
  ["/old/2021/leadership-lessons", null, 404, false, null],
];

function inventoryPages(crawledAt: string | null): SitePage[] {
  return INVENTORY.map(([path, title, code, jsonld, words], i) => ({
    id: `pg-${i}`,
    site: SITE,
    url: `${SITE}${path}`,
    status_code: code,
    title,
    h1: title,
    headline: title,
    meta_description: i % 3 === 1 || code !== 200 ? null : `${title ?? "Page"} — analysis from The Executive Narrative.`,
    canonical: code === 200 ? `${SITE}${path}` : null,
    og_count: jsonld ? 6 : i % 2 ? 0 : 3,
    has_jsonld: jsonld,
    word_count: words,
    headings: title ? [title] : [],
    fetched_at: crawledAt,
  }));
}

function siteAudit(store: NewsStore): SiteAudit {
  const live = Boolean(store.auditLiveAt);
  const src = live ? ("live" as const) : ("baseline" as const);
  const urls = (paths: string[]) => paths.map((p) => `${SITE}${p}`);
  const fix_list = INVENTORY.filter(([p, , code]) => code === 200 && p.split("/").length > 2).map(([path, title]) => {
    const [, cat, slug] = path.split("/");
    const category = (cat === "descisions" ? "decisions" : cat) as Category;
    const proposed = title ?? slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    return {
      url: `${SITE}${path}`,
      category,
      current_title: title,
      proposed_title: `${proposed.slice(0, 48)} — ${playbook(category).label}`,
      current_description: null,
      proposed_description: `${proposed}. What it means for senior leaders, the trade-offs involved and what to watch next, from The Executive Narrative.`.slice(0, 156),
      proposed_canonical: `${SITE}${path}`,
      proposed_slug: slug.length > 40 ? slug.split("-").slice(0, 5).join("-") : null,
      issues: [title ? "no meta description" : "missing title", "no Article JSON-LD"].concat(slug.length > 40 ? ["slug > 40 chars"] : []),
    };
  });
  return {
    findings: [
      { id: "f-meta", title: "Article pages have no meta description", severity: "critical", evidence: "61 of 152 article pages render an empty <meta name=description>; Google rewrites snippets from body text.", impact: "Lower click-through from search and LinkedIn previews.", affected_count: 4, affected_urls: urls(["/brief/why-capex-cycles-outlast-their-ceos", "/deep_dive/the-economics-of-second-sourcing", "/playbook/board-ready-ai-policy", "/room/inside-a-pricing-war-room"]), fix: "Every new article ships a 140–158 character description; the fix list covers existing posts.", source: src },
      { id: "f-jsonld", title: "No Article structured data on most posts", severity: "major", evidence: "Only 3 of 12 sampled pages emit JSON-LD; none include BreadcrumbList.", impact: "Not eligible for article rich results; weaker entity signals.", affected_count: 9, affected_urls: urls(["/brief", "/thinking", "/descisions", "/deep_dive"]), fix: "Article + BreadcrumbList JSON-LD on every publish.", source: src },
      { id: "f-dupe-title", title: "Category pages share near-duplicate titles", severity: "major", evidence: "Category index titles are a single word (“Brief”, “Thinking”) with no brand or context.", impact: "Weak relevance and brand recall in results pages.", affected_count: 4, affected_urls: urls(["/brief", "/thinking", "/descisions", "/deep_dive"]), fix: "Descriptive category titles with the brand suffix.", source: src },
      { id: "f-404", title: "Legacy URL returns 404 without a redirect", severity: "minor", evidence: "/old/2021/leadership-lessons is linked from 2 pages and returns 404.", impact: "Lost link equity and a broken experience.", affected_count: 1, affected_urls: urls(["/old/2021/leadership-lessons"]), fix: "301 to the closest current article.", source: src },
      { id: "f-sitemap", title: "Sitemap omits the /descisions/ section", severity: "info", evidence: "sitemap.xml lists 4 of 5 category sections.", impact: "Slower discovery of new Decisions pieces.", affected_count: 1, affected_urls: urls(["/descisions"]), fix: "Corrected sitemap.xml (download below).", source: src },
    ],
    summary: { pages: 184, article_pages: 152, with_issues: live ? 97 : null },
    crawled_at: store.auditLiveAt ?? "2026-10-20T09:30:00.000Z",
    source: src,
    note: live ? undefined : "Observed on the live site on 20 Oct 2026. Run the audit to replace this baseline with a fresh crawl.",
    fix_list,
    fix_count: fix_list.length,
  };
}

function competitors(store: NewsStore): { items: Competitor[]; own_pages: number } {
  const crawledAll = (store.competitorsAt ?? "") > hoursAgo(1);
  return {
    items: COMPETITORS.map((c) => {
      const crawled = c.pages > 0 || crawledAll;
      return {
        key: c.key,
        name: c.name,
        site: c.site,
        sitemap: null,
        max_pages: 40,
        last_crawled_at: crawled ? store.competitorsAt : null,
        pages: c.pages || (crawled ? 28 : 0),
        avg_word_count: c.avg || (crawled ? 1560 : null),
        jsonld_share: c.pages ? c.jsonld : crawled ? 0.86 : null,
        top_terms: (c.terms.length ? c.terms : crawled ? ["strategy", "ceo", "operations", "growth"] : []).map((term, i) => ({ term, pages: 14 - i * 2 })),
        gaps: c.gaps.length ? c.gaps : crawled ? ["corporate strategy", "ceo agenda"] : [],
        sample: c.pages ? [{ url: `${c.site}/`, title: c.name, word_count: c.avg }] : [],
      };
    }),
    own_pages: 184,
  };
}

function handleSeo(req: R, isTen: boolean): unknown {
  const [, id, action] = req.segments;
  if (!isTen) {
    if (id === "audit" && req.method === "GET" && !action) return { findings: [], summary: { pages: 0, article_pages: 0, with_issues: null }, crawled_at: null, source: "live", fix_list: [], fix_count: 0 } satisfies SiteAudit;
    if (id === "competitors" && req.method === "GET" && !action) return { items: [], own_pages: 0 };
    if (id === "inventory" && req.method === "GET" && !action) return { items: [], total: 0, page: 1, page_size: 100, crawled_at: null, sitemap: null };
    if (!id) return UNHANDLED;
    notFound(id === "audit" || id === "inventory" || id === "competitors" ? "Resource" : "Article");
  }
  const store = tenStore(req);
  if (id === "audit") {
    if (!action && req.method === "GET") return siteAudit(store);
    if (action === "export" || action === "sitemap") throw new DemoError(501, "demo_unavailable", DEMO_UNAVAILABLE);
    return UNHANDLED;
  }
  if (id === "inventory") {
    if (!action && req.method === "GET") {
      const q = (req.query.q ?? "").toLowerCase();
      const pages = inventoryPages(store.auditLiveAt ?? "2026-10-20T09:30:00.000Z").filter((p) => !q || p.url.toLowerCase().includes(q) || (p.title ?? "").toLowerCase().includes(q));
      return { ...pageOf(pages, req.query, 100), crawled_at: store.auditLiveAt ?? "2026-10-20T09:30:00.000Z", sitemap: { url: `${SITE}/sitemap.xml`, urls: 171, sections: 4 } };
    }
    if (action === "refresh" && req.method === "POST") return { job: createJob(req, "crawl_inventory", { stageMs: 3600 }) };
    return UNHANDLED;
  }
  if (id === "competitors") {
    if (!action && req.method === "GET") return competitors(store);
    if (action === "refresh" && req.method === "POST") return { job: createJob(req, "crawl_competitors", { stageMs: 3600 }) };
    return UNHANDLED;
  }
  if (!id) return UNHANDLED;
  const a = requireArticle(id);
  if (!action && req.method === "GET") {
    const p = currentPayload(a);
    return { article: { id: a.id, title: a.title, state: a.state, slug: a.slug }, seo: p.seo ? clone(p.seo) : null, h1: p.article?.title ?? null, dek: p.article?.dek ?? null };
  }
  if (!action && req.method === "PATCH") {
    const p = currentPayload(a);
    if (!p.seo) conflict("no_seo", "SEO has not run for this article");
    const b = (req.body ?? {}) as Partial<Record<"title_tag" | "meta_description" | "slug" | "primary_keyword" | "h1", string>>;
    const next = { ...clone(p.seo), ...b };
    const errors: string[] = [];
    if (next.title_tag.length > 60) errors.push(`Title tag is ${next.title_tag.length} characters (max 60)`);
    if (next.h1.trim() === next.title_tag.trim()) errors.push("H1 must differ from the title tag");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(next.slug) || next.slug.length > 60) errors.push("Slug must be lowercase words joined by hyphens, ≤60 characters");
    if (errors.length) invalid(errors.join("; "));
    const pb = playbook(a.category);
    next.canonical_url = `${SITE}${pb.route}/${next.slug}`;
    next.og = { ...next.og, title: next.h1, description: next.meta_description, url: next.canonical_url };
    next.twitter = { ...next.twitter, title: next.title_tag, description: next.meta_description };
    next.overrides = Array.from(new Set([...(next.overrides ?? []), ...Object.keys(b)]));
    next.issues = next.meta_description.length < 140 || next.meta_description.length > 158 ? [{ field: "meta_description", severity: "minor", message: `Meta description is ${next.meta_description.length} characters (target 140–158).` }] : [];
    next.score = next.issues.length ? 86 : 95;
    next.fields_complete = next.issues.length ? 14 : 15;
    a.slug = next.slug;
    addVersion(a, "seo", { ...clone(p), seo: next, qa: p.qa ? { ...p.qa, stale_seo: true } : p.qa }, nowIso(), `SEO override: ${Object.keys(b).join(", ")}`, owner(req).name);
    return { seo: clone(next) };
  }
  if (action === "regenerate" && req.method === "POST") {
    if (activeJob(a.id)) conflict("busy", "The article already has a running job");
    if (!currentPayload(a).article) conflict("no_draft", "Write a draft first");
    return { job: createJob(req, "seo", { article_id: a.id, stages: ["seo"], ctx: { keepState: true } }) };
  }
  return UNHANDLED;
}

/* ---------- Search ---------- */

function search(req: R, isTen: boolean): SearchResults {
  const q = (req.query.q ?? "").trim().toLowerCase();
  if (q.length < 2) return { articles: [], feed: [], sources: [] };
  const sources = ws(req).sources.filter((s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q)).slice(0, 5);
  if (!isTen) return { articles: [], feed: [], sources: clone(sources) };
  const store = tenStore(req);
  return {
    articles: store.articles.filter((a) => a.title.toLowerCase().includes(q) || (a.slug ?? "").includes(q)).slice(0, 8).map(summary),
    feed: clone(store.feed.filter((f) => f.title.toLowerCase().includes(q) || (f.publisher ?? "").toLowerCase().includes(q)).slice(0, 8)),
    sources: clone(sources),
  };
}

/* ---------- Settings ---------- */

function modelsView(req: R): ModelsView {
  return {
    provider: "ollama",
    base_url: "http://ollama:11434",
    reachable: true,
    available: ["qwen2.5:14b-instruct", "llama3.2:3b", "nomic-embed-text"],
    defaults: { writer: "qwen2.5:14b-instruct", fast: "llama3.2:3b", embed: "nomic-embed-text", num_ctx: 8192, timeout_s: 600, concurrency: 1 },
    agents: clone(ws(req).models),
    detail: null,
  };
}

function promptDetail(req: R, key: string): PromptDetail {
  const versions = ws(req).prompts[key];
  if (!versions) notFound("Prompt");
  const active = versions.find((v) => v.active) ?? versions[versions.length - 1];
  return { key, active: { version: active.version, body: active.body, source: active.source, id: active.id }, versions: clone(versions) };
}

function savePrompt(req: R, key: string, body: string, note: string | null): PromptDetail {
  const state = ws(req);
  const versions = (state.prompts[key] ??= []);
  const patchNo = versions.filter((v) => v.source === "db").length + 1;
  for (const v of versions) v.active = false;
  versions.unshift({ id: uid("pv-"), version: `1.0.${patchNo}`, body, note, source: "db", active: true, created_at: nowIso(), created_by: owner(req).name });
  return promptDetail(req, key);
}

function personaView(req: R): PersonaView {
  const d = promptDetail(req, "persona/ten");
  return {
    persona: { key: "persona/ten", version: d.active.version, body: d.active.body, source: d.active.source },
    structure: { version: "1.0.0", body: STRUCTURE_BODY },
    lexicon: { version: "1.0.0", body: LEXICON_BODY },
    banned_phrases: [...ws(req).banned].sort(),
    style_profile: {
      samples: { good: 10, bad: 5 },
      avg_sentence_len: { good: 17.8, bad: 26.4 },
      flesch: { good: 54.2, bad: 38.9 },
      second_person_rate: 0.012,
      numbers_per_100_words: 1.9,
      hedge_rate: 0.006,
      measured_at: hoursAgo(24 * 9),
    },
  };
}

function handleSettings(req: R): unknown {
  const state = ws(req);
  const [, area, a1, a2] = req.segments;
  const m = req.method;
  const b = req.body ?? {};
  switch (area) {
    case "tenant":
      if (a1) return UNHANDLED;
      if (m === "GET") return { tenant: clone(state.tenant), settings: clone(state.settings) };
      if (m === "PATCH") {
        if (typeof b.name === "string" && b.name.trim()) state.tenant.name = b.name.trim();
        if (typeof b.domain === "string") state.tenant.domain = b.domain.trim() || null;
        if (typeof b.timezone === "string" && b.timezone.trim()) state.tenant.timezone = b.timezone.trim();
        const s = (b.settings ?? {}) as Partial<TenantSettings>;
        for (const k of Object.keys(s) as (keyof TenantSettings)[]) {
          if (s[k] !== undefined && s[k] !== null) (state.settings as unknown as Record<string, unknown>)[k] = clone(s[k]);
        }
        const w = state.settings.scoring;
        const total = Object.values(w).reduce((x, y) => x + (Number(y) || 0), 0) || 1;
        for (const k of Object.keys(w) as (keyof typeof w)[]) w[k] = Math.round((w[k] / total) * 100) / 100;
        state.tenant.site_url = state.settings.brand.site_url || state.tenant.site_url;
        return { tenant: clone(state.tenant), settings: clone(state.settings) };
      }
      return UNHANDLED;
    case "users": {
      if (!a1 && m === "GET") return { items: clone(state.users) };
      if (!a1 && m === "POST") {
        const email = String(b.email ?? "").trim().toLowerCase();
        if (!email.includes("@")) invalid("Enter a valid email");
        if (String(b.password ?? "").length < 10) invalid("Password needs at least 10 characters");
        if (state.users.some((u) => u.email === email)) conflict("exists", "A user with this email already exists");
        const u: UserRow = { id: uid("usr-"), email, name: String(b.name ?? "") || email.split("@")[0], role: b.role ?? "editor", active: true, last_login_at: null };
        state.users.push(u);
        return clone(u);
      }
      const u = state.users.find((x) => x.id === a1);
      if (!u) notFound("User");
      if (m === "PATCH") {
        if (u.id === DEMO_OWNER_ID && (b.role || b.active === false)) conflict("self", "You cannot change your own role or deactivate yourself");
        if (b.role) u.role = b.role;
        if (typeof b.active === "boolean") u.active = b.active;
        return clone(u);
      }
      return UNHANDLED;
    }
    case "models":
      if (!a1 && m === "GET") return modelsView(req);
      if (!a1 && m === "POST") {
        const agents = (b.agents ?? {}) as Record<string, AgentModel>;
        for (const [k, v] of Object.entries(agents)) state.models[k] = { ...v };
        state.settings.models = { agents: clone(state.models) };
        return modelsView(req);
      }
      if (a1 === "test" && m === "POST") {
        const model = String(b.model ?? "llama3.2:3b");
        const known = modelsView(req).available.includes(model);
        const big = model.includes("14b");
        const res: ModelTest = known
          ? { ok: true, model, models: modelsView(req).available, latency_ms: big ? 2840 : 610, sample: '{"ok": true, "summary": "Capital is moving to packaging capacity."}', completion_tokens: 20, error: null }
          : { ok: false, model, models: modelsView(req).available, latency_ms: null, sample: null, completion_tokens: null, error: `model '${model}' not found, try pulling it first` };
        return res;
      }
      return UNHANDLED;
    case "prompts": {
      if (!a1 && m === "GET") {
        const items: PromptListItem[] = Object.entries(state.prompts).map(([key, versions]) => {
          const active = versions.find((v) => v.active) ?? versions[0];
          return { key, version: active.version, source: active.source, chars: active.body.length };
        });
        return { items };
      }
      // keys contain a slash: /settings/prompts/agents/writer[/activate]
      const parts = req.segments.slice(2).map((x) => decodeURIComponent(x)).join("/").split("/").filter(Boolean);
      if (!parts.length) return UNHANDLED;
      const activate = parts.length > 1 && parts[parts.length - 1] === "activate";
      const key = (activate ? parts.slice(0, -1) : parts).join("/");
      if (activate && m === "POST") {
        const versions = state.prompts[key];
        if (!versions) notFound("Prompt");
        const target = versions.find((v) => v.id === b.version_id);
        if (!target) notFound("Prompt version");
        for (const v of versions) v.active = v.id === target.id;
        return promptDetail(req, key);
      }
      if (activate) return UNHANDLED;
      if (m === "GET") return promptDetail(req, key);
      if (m === "PUT") {
        const body = String(b.body ?? "");
        if (body.trim().length < 20) invalid("Prompt is too short");
        return savePrompt(req, key, body, b.note ?? null);
      }
      return UNHANDLED;
    }
    case "persona":
      if (a1) return UNHANDLED;
      if (m === "GET") return personaView(req);
      if (m === "PUT") {
        if (typeof b.persona === "string") savePrompt(req, "persona/ten", b.persona, b.note ?? null);
        if (Array.isArray(b.banned_phrases)) state.banned = b.banned_phrases.map((p: unknown) => String(p).toLowerCase()).filter((p: string) => p.length >= 3);
        return personaView(req);
      }
      return UNHANDLED;
    case "integrations": {
      const v = state.integrations;
      if (!a1 && m === "GET") return clone(v);
      if (!a1 && m === "PUT") {
        if (b.default_target) v.default_target = b.default_target as PublishTarget;
        const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
        if (b.ten_static) {
          const t = v.targets.ten_static;
          const s = b.ten_static as Record<string, string>;
          for (const k of ["site_url", "public_root", "sftp_host", "sftp_user", "sftp_key_path"] as const) if (k in s) t[k] = str(s[k]);
          if ("sftp_port" in s) t.sftp_port = Number(s.sftp_port) || null;
          if ("sftp_password" in s) t.password_configured = Boolean(s.sftp_password);
          t.mode = t.sftp_host ? "sftp" : "local";
          t.note = t.mode === "local" ? "No SFTP host configured: pages publish to the local staging site (/site/…) plus an export bundle." : null;
        }
        if (b.wordpress) {
          const w = v.targets.wordpress;
          const s = b.wordpress as Record<string, string>;
          if ("url" in s) w.url = str(s.url);
          if ("user" in s) w.user = str(s.user);
          if ("app_password" in s) w.password_configured = Boolean(s.app_password);
          w.configured = Boolean(w.url && w.user && w.password_configured);
        }
        if (b.webhook) {
          const w = v.targets.webhook;
          const s = b.webhook as Record<string, string>;
          if ("url" in s) w.url = str(s.url);
          if ("secret" in s) w.secret_configured = Boolean(s.secret);
          w.configured = Boolean(w.url);
        }
        if (b.linkedin) {
          const li = v.linkedin;
          const s = b.linkedin as Record<string, string>;
          for (const k of ["client_id", "redirect_uri", "org_urn", "author_type"] as const) if (k in s) li[k] = str(s[k]);
          li.client_id_set = Boolean(li.client_id);
          if ("client_secret" in s) li.client_secret_set = Boolean(s.client_secret);
          if ("access_token" in s) {
            li.connected = Boolean(s.access_token);
            li.author_urn = li.connected ? (li.org_urn ?? "urn:li:person:demo") : null;
            li.expires_at = li.connected ? daysAhead(60) : null;
          }
        }
        return clone(v);
      }
      if (a1 === "test" && m === "POST") {
        const target = String(b.target ?? "");
        const t = v.targets;
        const res: Record<string, { ok: boolean; detail: string }> = {
          export: { ok: true, detail: "Wrote and removed a test bundle (4 files, 18 KB) in the export folder." },
          ten_static: t.ten_static.mode === "local" ? { ok: true, detail: `Local staging is writable: ${t.ten_static.public_root ?? "/srv/site/public"} (dry write + delete ok).` } : { ok: true, detail: `SFTP ${t.ten_static.sftp_user ?? "user"}@${t.ten_static.sftp_host}: connected, public root writable.` },
          wordpress: t.wordpress.configured ? { ok: true, detail: `Authenticated to ${t.wordpress.url} as ${t.wordpress.user}; can create drafts.` } : { ok: false, detail: "WordPress is not configured: add the site URL, user and an application password." },
          webhook: t.webhook.configured ? { ok: true, detail: `POST ${t.webhook.url} → 200 in 212 ms (signature verified).` } : { ok: false, detail: "No webhook URL configured." },
          linkedin: v.linkedin.connected ? { ok: true, detail: `Token valid for ${v.linkedin.author_urn}; expires in ${Math.max(1, Math.round((Date.parse(v.linkedin.expires_at ?? "") - Date.now()) / 86_400_000))} days.` } : { ok: false, detail: "Not connected: no access token." },
        };
        return res[target] ?? { ok: false, detail: `Unknown target ${target}` };
      }
      if (a1 === "linkedin" && a2 === "connect") throw new DemoError(501, "demo_unavailable", DEMO_UNAVAILABLE);
      if (a1 === "linkedin" && a2 === "disconnect" && m === "POST") {
        v.linkedin.connected = false;
        v.linkedin.author_urn = null;
        v.linkedin.expires_at = null;
        return clone(v);
      }
      return UNHANDLED;
    }
    case "evals": {
      if (!a1 && m === "GET") return { cases: clone(EVAL_CASES), runs: state.evalRuns.map((r) => ({ ...clone(r), details: undefined })), latest: state.evalRuns[0] ? clone(state.evalRuns[0]) : null };
      if (a1 === "run" && m === "POST") {
        const suite = String(b.suite ?? "deterministic");
        return { job: createJob(req, "eval", { ctx: { suite }, payload: { suite }, stageMs: suite === "deterministic" ? 2000 : 4200 }) };
      }
      if (a1 && m === "GET") {
        const run = state.evalRuns.find((r) => r.id === a1);
        if (!run) notFound("Evaluation run");
        return clone(run);
      }
      return UNHANDLED;
    }
    case "maintenance": {
      if (m !== "POST" || !a1) return UNHANDLED;
      if (b.confirm !== state.tenant.slug) throw new DemoError(400, "confirmation_mismatch", `Type “${state.tenant.slug}” to confirm`);
      const isTen = (req.workspace || TEN) === TEN;
      if (a1 === "retention") return { ok: true, detail: { model_runs_trimmed: 12, feed_items_pruned: 0, jobs_deleted: 4, sessions_expired: 1 } };
      if (a1 === "purge_feed") {
        let n = 0;
        if (isTen && news) {
          const before = news.feed.length;
          const cutoff = Date.now() - (Number(b.older_than_days) || 30) * 86_400_000;
          news.feed = news.feed.filter((f) => f.status === "promoted" || Date.parse(f.fetched_at ?? "") > cutoff);
          n = before - news.feed.length;
        }
        return { ok: true, detail: { feed_items_deleted: n } };
      }
      if (a1 === "clear_dead_jobs") {
        let n = 0;
        for (let i = jobs.length - 1; i >= 0; i--) {
          if (jobs[i].ws === (req.workspace || TEN) && (jobs[i].job.status === "failed" || jobs[i].job.status === "dead")) {
            jobs.splice(i, 1);
            n++;
          }
        }
        return { ok: true, detail: { jobs_deleted: n } };
      }
      if (a1 === "revoke_sessions") return { ok: true, detail: { sessions_revoked: 2 } };
      notFound("Maintenance action");
    }
    default:
      return UNHANDLED;
  }
  return UNHANDLED;
}

/* ====================================================================================== */
/* Entry point                                                                            */
/* ====================================================================================== */

const OWNED = new Set(["health", "playbooks", "jobs", "dashboard", "feed", "sources", "articles", "topics", "publications", "seo", "social", "search", "settings"]);

export const handleNewsroom: DemoHandler = (req) => {
  const root = req.segments[0];
  if (!OWNED.has(root)) return UNHANDLED;
  const isTen = (req.workspace || TEN) === TEN;
  ws(req);
  if (isTen) tenStore(req);
  tick();
  switch (root) {
    case "health":
      return req.segments.length === 1 && req.method === "GET" ? health(req) : UNHANDLED;
    case "playbooks":
      return req.segments.length === 1 && req.method === "GET" ? { items: clone(PLAYBOOKS) } : UNHANDLED;
    case "dashboard":
      if (req.method !== "GET") return UNHANDLED;
      if (req.segments[1] === "summary") return dashboardSummary(req);
      if (req.segments[1] === "activity") {
        const limit = Math.min(200, Number(req.query.limit) || 30);
        return { items: isTen ? clone(tenStore(req).audit.slice(0, limit)) : [] };
      }
      return UNHANDLED;
    case "search":
      return req.method === "GET" && req.segments.length === 1 ? search(req, isTen) : UNHANDLED;
    case "jobs":
      return handleJobs(req);
    case "feed":
      return handleFeed(req, isTen);
    case "sources":
      return handleSources(req);
    case "articles":
      return handleArticles(req, isTen);
    case "topics":
      return handleTopics(req, isTen);
    case "publications":
      return handlePublications(req, isTen);
    case "social":
      return handleSocial(req, isTen);
    case "seo":
      return handleSeo(req, isTen);
    case "settings":
      return handleSettings(req);
    default:
      return UNHANDLED;
  }
};
