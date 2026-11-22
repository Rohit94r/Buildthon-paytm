// Demo backend entry point: routes api() calls to the in-memory handlers. Never touches the network.
import { DemoError, UNHANDLED, type DemoHandler, type DemoMethod, type DemoRequest, type DemoTenant } from "./core";
import { WORKSPACE_KEY } from "./mode";
import { handleNewsroom } from "./newsroom";
import { handleOps, meFor, opsPostProcess } from "./ops";
import { DEMO_DEFAULT_WORKSPACE, demoWorkspace, handlePlatform } from "./platform";

export { DemoError } from "./core";

const HANDLERS: DemoHandler[] = [handleOps, handlePlatform, handleNewsroom];

function activeWorkspace(): string {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(WORKSPACE_KEY) : null;
    if (v && demoWorkspace(v)) return v;
  } catch {
    /* ignore */
  }
  return DEMO_DEFAULT_WORKSPACE;
}

function tenantFor(slug: string): DemoTenant {
  const ws = demoWorkspace(slug);
  return { slug, name: ws?.name ?? slug, domain: ws?.domain ?? null, timezone: ws?.timezone ?? "Asia/Kolkata" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shape for endpoints nobody owns yet: valid-but-empty so pages render instead of crashing. */
function fallback(req: DemoRequest): unknown {
  console.warn(`[demo] no mock for ${req.method} ${req.path}; returning an empty response`);
  if (req.text) return "";
  if (req.method === "DELETE") return undefined;
  if (req.method === "GET") return { items: [], total: 0 };
  return { ok: true };
}

export async function demoFetch<T>(method: DemoMethod, path: string, query: Record<string, string>, body: unknown, text: boolean, workspaceOverride?: string): Promise<T> {
  // Small, varied latency so loading states are visible but the demo feels fast.
  await sleep(method === "GET" ? 60 + Math.random() * 120 : 180 + Math.random() * 220);
  const workspace = workspaceOverride && demoWorkspace(workspaceOverride) ? workspaceOverride : activeWorkspace();
  const clean = path.split("?")[0];
  const req: DemoRequest = {
    method,
    path: clean,
    segments: clean.split("/").filter(Boolean).map((s) => decodeURIComponent(s)),
    query,
    body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)),
    workspace,
    tenant: tenantFor(workspace),
    text,
  };
  if (req.segments[0] === "auth") {
    const sub = req.segments[1];
    if (sub === "me" || sub === "login" || sub === "setup" && method === "POST") return meFor(workspace) as T;
    if (sub === "setup") return { needs_setup: false } as T;
    if (sub === "logout") return { ok: true } as T;
  }
  for (const h of HANDLERS) {
    const out = h(req);
    if (out !== UNHANDLED) return opsPostProcess(req, out) as T;
  }
  return fallback(req) as T;
}

export function isDemoError(e: unknown): e is DemoError {
  return e instanceof DemoError;
}
