// Shared plumbing for the in-memory demo backend (no network, no persistence beyond the tab).

export type DemoMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface DemoTenant {
  slug: string;
  name: string;
  domain: string | null;
  timezone: string;
}

export interface DemoRequest {
  method: DemoMethod;
  /** Path relative to /api/v1, e.g. "/articles/abc/run" (no query string). */
  path: string;
  /** path split on "/", empty parts removed: "/articles/abc/run" -> ["articles", "abc", "run"]. */
  segments: string[];
  query: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  /** Active workspace slug (X-Workspace). */
  workspace: string;
  tenant: DemoTenant;
  /** Caller asked for a text response (api(..., { text: true })). Return a string. */
  text: boolean;
}

/** Thrown by handlers to produce an HTTP-style error (becomes ApiError in lib/api). */
export class DemoError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Returned by a handler that does not own the route. */
export const UNHANDLED: unique symbol = Symbol("unhandled");
export type Unhandled = typeof UNHANDLED;
export type DemoHandler = (req: DemoRequest) => unknown | Unhandled;

let seq = 1000;
export function uid(prefix = ""): string {
  seq += 1;
  const rand = Math.random().toString(16).slice(2, 10);
  return `${prefix}${rand}${seq.toString(16)}`;
}

export const nowIso = () => new Date().toISOString();
export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
export const hoursAgo = (h: number) => minutesAgo(h * 60);
export const daysAgo = (d: number) => minutesAgo(d * 1440);
export const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function notFound(what = "Resource"): never {
  throw new DemoError(404, "not_found", `${what} not found`);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "item"
  );
}

/** Deterministic pseudo-random in [0,1) from a string seed (stable charts across reloads). */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paginate<T>(items: T[], query: Record<string, string>, defLimit = 50): { items: T[]; total: number } {
  const limit = Number(query.limit ?? defLimit) || defLimit;
  const offset = Number(query.offset ?? 0) || 0;
  return { items: items.slice(offset, offset + limit), total: items.length };
}
