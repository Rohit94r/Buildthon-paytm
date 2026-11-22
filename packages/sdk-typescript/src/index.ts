/**
 * @layerflow/sdk — TypeScript client for the LayerFlow public API (Node 18+, Deno, Bun, edge runtimes, browsers).
 *
 *   import { LayerFlow, verifyWebhook } from "@layerflow/sdk";
 *   const lf = new LayerFlow({ baseUrl: "https://agents.example.com", apiKey: process.env.LAYERFLOW_API_KEY! });
 *   const { items } = await lf.content.list({ limit: 10 });
 *   const run = await lf.workflows.run("pipeline-id", { input: { url: "https://…" } }, { wait: true });
 *
 * Docs: docs/integrations/sdk.md · API: docs/platform/API.md
 */

export interface LayerFlowOptions {
  baseUrl: string;
  apiKey: string;
  /** Request timeout in ms (default 30 000). */
  timeoutMs?: number;
  /** Custom fetch (tests, proxies). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

export interface FlowItemInput {
  title?: string;
  url?: string | null;
  text?: string;
  summary?: string | null;
  data?: Record<string, unknown>;
}

export interface PublicContent {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body_markdown: string;
  body_html: string;
  format: string;
  variants: Record<string, string>;
  tags: string[];
  image_url: string | null;
  source_url: string | null;
  seo: { title_tag?: string; meta_description?: string; json_ld?: Record<string, unknown> } | null;
  published_at: string;
}

export interface DatasetRecord<T = Record<string, unknown>> {
  id: string;
  key: string;
  data: T;
  source_url: string | null;
  updated_at: string;
}

export interface ChatResult {
  answer: string;
  records: DatasetRecord[];
  table: {
    fields: { key: string; label: string; type: string; unit?: string }[];
    rows: { key: string; values: Record<string, unknown> }[];
    winners: Record<string, string>;
  } | null;
  suggestions: string[];
  model: string;
  latency_ms: number;
}

export type RunStatus = "queued" | "running" | "awaiting_approval" | "succeeded" | "failed" | "cancelled";

export interface PublicRun {
  id: string;
  status: RunStatus;
  workflow: { id: string; name: string } | null;
  agent: { id: string; name: string } | null;
  created_at: string;
  finished_at: string | null;
  steps: { name: string; status: string; items_out: number }[];
  output: { items: (FlowItemInput & { id: string; formats?: Record<string, string>; flags?: string[] })[]; content_ids: string[] } | null;
  error: string | null;
}

export interface RunRequest {
  input?: { text?: string; url?: string; items?: FlowItemInput[]; data?: Record<string, unknown> };
}

export interface RunOptions {
  /** Poll until the run finishes (or `timeoutMs`). */
  wait?: boolean;
  timeoutMs?: number;
  pollMs?: number;
  /** De-duplicates retries of the same logical request for 24h. */
  idempotencyKey?: string;
}

export class LayerFlowError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "LayerFlowError";
  }
}

const TERMINAL: RunStatus[] = ["succeeded", "failed", "cancelled", "awaiting_approval"];

export class LayerFlow {
  private base: string;
  private key: string;
  private timeoutMs: number;
  private f: typeof fetch;

  constructor(opts: LayerFlowOptions) {
    if (!opts.baseUrl || !opts.apiKey) throw new Error("LayerFlow: baseUrl and apiKey are required");
    this.base = opts.baseUrl.replace(/\/$/, "") + "/api/public/v1";
    this.key = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.f(this.base + path, {
        method,
        headers: {
          "X-API-Key": this.key,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : undefined;
      if (!res.ok) {
        const e = data?.error ?? {};
        throw new LayerFlowError(res.status, e.code ?? "http_error", e.message ?? `Request failed (${res.status})`, e.details);
      }
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private qs(q: Record<string, string | number | undefined>): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  }

  /** Published content (articles, posts, all formats). Scope: content:read */
  content = {
    list: (q: { limit?: number; offset?: number; tag?: string; format?: string } = {}) =>
      this.req<{ items: PublicContent[]; total: number }>("GET", `/content${this.qs(q)}`),
    get: (slug: string) => this.req<PublicContent>("GET", `/content/${encodeURIComponent(slug)}`),
  };

  /** Public datasets (colleges, hackathons, products…). Scope: datasets:read */
  datasets = {
    records: <T = Record<string, unknown>>(dataset: string, q: { q?: string; limit?: number; offset?: number; sort?: string } = {}) =>
      this.req<{ items: DatasetRecord<T>[]; total: number }>("GET", `/datasets/${encodeURIComponent(dataset)}/records${this.qs(q)}`),
    record: <T = Record<string, unknown>>(dataset: string, key: string) =>
      this.req<DatasetRecord<T>>("GET", `/datasets/${encodeURIComponent(dataset)}/records/${encodeURIComponent(key)}`),
  };

  /** Real-time assistant (comparison / Q&A over a dataset). Scope: assistant:chat */
  chat(req: { message: string; dataset?: string; assistant_id?: string; history?: { role: "user" | "assistant"; content: string }[]; compare_keys?: string[] }) {
    return this.req<ChatResult>("POST", "/chat", req);
  }

  /** Runs. Scopes: runs:write to start, runs:read to poll. */
  runs = {
    get: (runId: string) => this.req<PublicRun>("GET", `/runs/${encodeURIComponent(runId)}`),
    wait: async (runId: string, opts: { timeoutMs?: number; pollMs?: number } = {}) => {
      const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
      const poll = opts.pollMs ?? 2_000;
      for (;;) {
        const run = await this.runs.get(runId);
        if (TERMINAL.includes(run.status)) return run;
        if (Date.now() > deadline) return run;
        await new Promise((r) => setTimeout(r, poll));
      }
    },
  };

  private async start(path: string, body: RunRequest, opts: RunOptions): Promise<PublicRun> {
    const headers: Record<string, string> = {};
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const run = await this.req<PublicRun>("POST", path, body, headers);
    return opts.wait ? this.runs.wait(run.id, opts) : run;
  }

  /** Trigger a whole workflow (pipeline) from your app. */
  workflows = {
    run: (pipelineId: string, body: RunRequest = {}, opts: RunOptions = {}) =>
      this.start(`/workflows/${encodeURIComponent(pipelineId)}/run`, body, opts),
  };

  /** Trigger a single agent from your app. */
  agents = {
    run: (agentId: string, body: RunRequest = {}, opts: RunOptions = {}) =>
      this.start(`/agents/${encodeURIComponent(agentId)}/run`, body, opts),
  };
}

/**
 * Verify an incoming LayerFlow webhook (X-LayerFlow-Signature: sha256=<hex>) using Web Crypto.
 * Pass the RAW request body string, exactly as received.
 */
export async function verifyWebhook(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = signatureHeader.slice(7);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default LayerFlow;
