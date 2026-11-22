"use client";

import { format, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDot, Clock, Cpu, Hand, Play, RotateCcw, SkipForward, Square, Terminal, Wrench, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { activeWorkspace, apiUrl, get } from "@/lib/api";
import { isDemoMode } from "@/lib/demo/mode";
import type { ExecutionEvent, ExecutionEventType } from "@/lib/platform-ops-types";
import { cn } from "@/components/ui";

type Scope = { agentId?: string; runId?: string };

function pollPath(s: Scope): string {
  if (s.runId) return `/runs/${s.runId}/events`;
  if (s.agentId) return `/agents/${s.agentId}/events`;
  return "/activity";
}

/**
 * Live execution events. Real backend: SSE on /events/stream (workspace passed as a query param since EventSource
 * can't send headers) with a polling fallback. Demo mode: polling only (the mock has no stream).
 */
export function useExecutionEvents(scope: Scope, opts: { intervalMs?: number; enabled?: boolean } = {}) {
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [mode, setMode] = useState<"connecting" | "live" | "polling">("connecting");
  const [loaded, setLoaded] = useState(false);
  const last = useRef(0);
  const enabled = opts.enabled ?? true;
  const interval = opts.intervalMs ?? 1500;
  const key = `${scope.agentId ?? ""}|${scope.runId ?? ""}`;

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    last.current = 0;
    setEvents([]);
    setLoaded(false);
    const add = (items: ExecutionEvent[]) => {
      const fresh = items.filter((e) => e.id > last.current);
      if (!fresh.length) return;
      last.current = Math.max(...fresh.map((e) => e.id));
      setEvents((prev) => [...prev, ...fresh].slice(-500));
    };
    const tick = async () => {
      try {
        const r = await get<{ items: ExecutionEvent[] }>(pollPath(scope), { after: last.current || undefined, limit: 200 });
        if (!closed) {
          add(r.items ?? []);
          setLoaded(true);
        }
      } catch {
        if (!closed) setLoaded(true);
      }
    };
    const startPolling = () => {
      setMode("polling");
      void tick();
      timer = setInterval(tick, interval);
    };
    if (isDemoMode() || typeof EventSource === "undefined") {
      startPolling();
    } else {
      void tick().then(() => {
        if (closed) return;
        es = new EventSource(apiUrl("/events/stream", { agent_id: scope.agentId, run_id: scope.runId, workspace: activeWorkspace() ?? undefined, after: last.current || undefined }), { withCredentials: true });
        es.onopen = () => !closed && setMode("live");
        es.onmessage = (m) => {
          try {
            add([JSON.parse(m.data) as ExecutionEvent]);
          } catch {
            /* heartbeat or malformed */
          }
        };
        const types: ExecutionEventType[] = ["run.queued", "run.started", "step.started", "step.log", "tool.called", "tool.result", "model.called", "step.finished", "step.failed", "step.skipped", "run.awaiting_approval", "run.retrying", "run.finished", "run.failed", "run.cancelled"];
        for (const t of types)
          es.addEventListener(t, (m) => {
            try {
              add([JSON.parse((m as MessageEvent).data) as ExecutionEvent]);
            } catch {
              /* ignore */
            }
          });
        let errors = 0;
        es.onerror = () => {
          errors += 1;
          if (errors >= 3 && es) {
            es.close();
            es = null;
            if (!closed) startPolling();
          }
        };
      });
    }
    return () => {
      closed = true;
      es?.close();
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, interval]);

  return { events, mode, loaded };
}

const ICON: Partial<Record<ExecutionEventType, typeof Play>> = {
  "run.queued": Clock,
  "run.started": Play,
  "step.started": CircleDot,
  "step.log": Terminal,
  "tool.called": Wrench,
  "tool.result": Wrench,
  "model.called": Cpu,
  "step.finished": CheckCircle2,
  "step.failed": XCircle,
  "step.skipped": SkipForward,
  "run.awaiting_approval": Hand,
  "run.retrying": RotateCcw,
  "run.finished": CheckCircle2,
  "run.failed": XCircle,
  "run.cancelled": Square,
};

function tone(e: ExecutionEvent): string {
  if (e.level === "error" || e.type.endsWith("failed")) return "text-bad bg-bad-soft";
  if (e.level === "warn" || e.type === "run.awaiting_approval") return "text-warn bg-warn-soft";
  if (e.type === "run.finished" || e.type === "step.finished") return "text-ok bg-ok-soft";
  if (e.type === "tool.called" || e.type === "model.called") return "text-accent bg-accent-soft";
  return "text-ink-2 bg-surface-2";
}

function time(iso: string) {
  try {
    return format(parseISO(iso), "HH:mm:ss");
  } catch {
    return "";
  }
}

export function EventTimeline({ events, newestFirst = true, showAgent, empty, className }: { events: ExecutionEvent[]; newestFirst?: boolean; showAgent?: boolean; empty?: ReactNode; className?: string }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const list = newestFirst ? [...events].reverse() : events;
  if (!list.length) return <>{empty ?? <p className="py-10 text-center text-[13px] text-muted">No activity yet.</p>}</>;
  return (
    <ol className={cn("relative", className)}>
      {list.map((e, i) => {
        const Icon = ICON[e.type] ?? (e.level === "warn" ? AlertTriangle : Terminal);
        const hasData = e.data && Object.keys(e.data).length > 0;
        const isOpen = open[e.id];
        return (
          <li key={e.id} className={cn("relative flex gap-3 pb-3", i < 12 && newestFirst && "animate-in")}>
            {i < list.length - 1 ? <span className="absolute top-7 bottom-0 left-[13px] w-px bg-line" aria-hidden /> : null}
            <span className={cn("relative z-[1] mt-0.5 flex size-[27px] shrink-0 items-center justify-center rounded-full ring-4 ring-surface", tone(e))}>
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <button type="button" disabled={!hasData} onClick={() => setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))} className="flex w-full items-start gap-2 text-left disabled:cursor-default">
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] text-ink">{e.message}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
                    <span className="font-mono tabular">{time(e.at)}</span>
                    {showAgent && e.agent_name ? <span>· {e.agent_name}</span> : null}
                    {typeof e.data?.tool === "string" ? <span className="font-mono">· {e.data.tool}</span> : null}
                    {typeof e.data?.duration_ms === "number" ? <span>· {e.data.duration_ms} ms</span> : null}
                  </span>
                </span>
                {hasData ? <ChevronRight className={cn("mt-1 size-3.5 shrink-0 text-muted transition-transform", isOpen && "rotate-90")} aria-hidden /> : null}
              </button>
              {isOpen && hasData ? <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[11.5px] text-ink-2">{JSON.stringify(e.data, null, 2)}</pre> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function LiveBadge({ mode }: { mode: "connecting" | "live" | "polling" }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-2">
      <span className={cn("size-1.5 rounded-full", mode === "connecting" ? "bg-muted" : "live-dot bg-ok")} />
      {mode === "live" ? "Live" : mode === "polling" ? "Live · polling" : "Connecting…"}
    </span>
  );
}
