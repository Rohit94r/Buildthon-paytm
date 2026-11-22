// Same-origin JSON client for /api/v1. Session = HTTP-only cookie; CSRF = double-submit (lf_csrf cookie → header).
// Active workspace = localStorage["lf-workspace"], sent as X-Workspace. In demo mode no request leaves the browser:
// everything is answered by the in-memory mock backend in lib/demo/.
import { isDemoMode, WORKSPACE_KEY } from "./demo/mode";

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)lf_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function apiUrl(path: string, query?: Query): string {
  return `${API_BASE}${path}${qs(query)}`;
}

interface Options {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  text?: boolean;
  redirectOn401?: boolean;
  /** Act on another workspace than the active one (sent as X-Workspace). */
  workspace?: string;
}

let redirecting = false;

export function activeWorkspace(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

/** Switch the active workspace. Callers should then clear the query cache (see useSwitchWorkspace). */
export function setActiveWorkspace(slug: string | null) {
  try {
    if (slug) window.localStorage.setItem(WORKSPACE_KEY, slug);
    else window.localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function demoApi<T>(path: string, opts: Options): Promise<T> {
  const { demoFetch, isDemoError } = await import("./demo");
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") query[k] = String(v);
  try {
    return await demoFetch<T>(opts.method ?? "GET", path, query, opts.body, Boolean(opts.text), opts.workspace);
  } catch (e) {
    if (isDemoError(e)) throw new ApiError(e.status, e.code, e.message);
    throw e;
  }
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  if (isDemoMode()) return demoApi<T>(path, opts);
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: opts.text ? "text/html" : "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken();
  const ws = opts.workspace ?? activeWorkspace();
  if (ws) headers["X-Workspace"] = ws;
  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), {
      method,
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network_error", "Cannot reach the API. Is the backend running?");
  }
  if (res.status === 401 && opts.redirectOn401 !== false && typeof window !== "undefined" && !path.startsWith("/auth/login")) {
    if (!redirecting && !window.location.pathname.startsWith("/login")) {
      redirecting = true;
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
    throw new ApiError(401, "unauthenticated", "Sign in to continue");
  }
  if (!res.ok) {
    let code = "http_error";
    let message = `Request failed (${res.status})`;
    let details: unknown;
    try {
      const data = await res.json();
      if (data?.error) {
        code = data.error.code ?? code;
        message = data.error.message ?? message;
        details = data.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message, details);
  }
  if (opts.text) return (await res.text()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

const FRIENDLY: Record<string, (e: ApiError) => string> = {
  quota_exceeded: (e) => {
    const d = (e.details ?? {}) as { limit?: number; used?: number };
    return `Plan limit reached${d.limit !== undefined ? ` (${d.used ?? d.limit}/${d.limit})` : ""}. Upgrade the plan or wait for the quota to reset.`;
  },
  upgrade_required: (e) => `${e.message.replace(/\.$/, "")}. Upgrade the plan to use this agent.`,
  workspace_suspended: () => "This workspace is suspended, so nothing can run. Contact your LayerFlow admin.",
  workspace_forbidden: () => "You don't have access to this workspace.",
  network_error: () => "Cannot reach the LayerFlow API. Start the backend, or explore the live demo instead.",
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const friendly = FRIENDLY[e.code];
    if (friendly) return friendly(e);
    if (Array.isArray(e.details) && e.details.length && typeof e.details[0] === "string") {
      return `${e.message}: ${(e.details as string[]).join("; ")}`;
    }
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
