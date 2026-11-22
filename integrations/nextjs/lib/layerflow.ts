// LayerFlow client for Next.js (App Router). Copy this file into your site as `lib/layerflow.ts`.
//
// .env.local
//   LAYERFLOW_API_URL=https://agents.yourdomain.com
//   LAYERFLOW_API_KEY=lf_pk_...            (scopes: content:read, datasets:read)
//   LAYERFLOW_WEBHOOK_SECRET=...            (from the Next.js connection in LayerFlow → Connections)
//
// Server-only: never import this file from a "use client" component (it reads the API key).
// Tip: `npm i server-only` and add `import "server-only";` here to make Next.js enforce that.

const API = (process.env.LAYERFLOW_API_URL || "").replace(/\/$/, "");
const KEY = process.env.LAYERFLOW_API_KEY || "";

export interface LayerFlowPost {
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

export interface LayerFlowRecord<T = Record<string, unknown>> {
  id: string;
  key: string;
  data: T;
  source_url: string | null;
  updated_at: string;
}

async function lf<T>(path: string, init: RequestInit & { revalidate?: number; tags?: string[] } = {}): Promise<T> {
  if (!API || !KEY) throw new Error("LAYERFLOW_API_URL and LAYERFLOW_API_KEY must be set");
  const { revalidate = 300, tags = ["layerflow"], ...rest } = init;
  const res = await fetch(`${API}/api/public/v1${path}`, {
    ...rest,
    headers: { "X-API-Key": KEY, Accept: "application/json", ...(rest.headers || {}) },
    // Cached + tagged: the webhook route below calls revalidateTag("layerflow") when content is published.
    next: { revalidate, tags },
  });
  if (!res.ok) throw new Error(`LayerFlow ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Published posts, newest first. */
export function getPosts(opts: { limit?: number; offset?: number; tag?: string; format?: string } = {}) {
  const q = new URLSearchParams();
  q.set("limit", String(opts.limit ?? 20));
  if (opts.offset) q.set("offset", String(opts.offset));
  if (opts.tag) q.set("tag", opts.tag);
  if (opts.format) q.set("format", opts.format);
  return lf<{ items: LayerFlowPost[]; total: number }>(`/content?${q}`);
}

/** One published post by slug, or null. */
export async function getPost(slug: string): Promise<LayerFlowPost | null> {
  try {
    return await lf<LayerFlowPost>(`/content/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }
}

/** Records from a public dataset (e.g. "colleges"). `sort` is "field:asc" or "field:desc". */
export function getRecords<T = Record<string, unknown>>(
  dataset: string,
  opts: { q?: string; limit?: number; offset?: number; sort?: string } = {},
) {
  const q = new URLSearchParams();
  q.set("limit", String(opts.limit ?? 50));
  if (opts.q) q.set("q", opts.q);
  if (opts.offset) q.set("offset", String(opts.offset));
  if (opts.sort) q.set("sort", opts.sort);
  return lf<{ items: LayerFlowRecord<T>[]; total: number }>(`/datasets/${encodeURIComponent(dataset)}/records?${q}`, {
    tags: ["layerflow", `dataset:${dataset}`],
  });
}

/** One record by key (e.g. "IIT Bombay"), or null. */
export async function getRecord<T = Record<string, unknown>>(dataset: string, key: string): Promise<LayerFlowRecord<T> | null> {
  try {
    return await lf<LayerFlowRecord<T>>(`/datasets/${encodeURIComponent(dataset)}/records/${encodeURIComponent(key)}`);
  } catch {
    return null;
  }
}

/** Ask the comparison assistant from the server (e.g. a server action). Needs the assistant:chat scope. */
export function askAssistant(dataset: string, message: string, compare_keys?: string[]) {
  return lf<{ answer: string; table: unknown; suggestions: string[] }>(`/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset, message, compare_keys }),
    revalidate: 0,
  });
}
