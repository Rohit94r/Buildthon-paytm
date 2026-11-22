"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { Bot, Clock, Database, FileText, Flame, Info, Play, Plug, Send, Sparkles, Target, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilterChips } from "@/components/platform/kit";
import { Button, Card, ErrorState, Skeleton, cn } from "@/components/ui";
import { activeWorkspace, apiUrl, get } from "@/lib/api";
import { isDemoMode } from "@/lib/demo/mode";
import { num, pct } from "@/lib/format";
import type { ActivityItem, WorkspaceProgress } from "@/lib/platform-ops-types";
import { useWorkspace } from "@/lib/workspace";

type F = "all" | "run" | "agent" | "content" | "data" | "connection" | "team";
const FILTER_CATS: Record<F, string | undefined> = { all: undefined, run: "run", agent: "agent", content: "content,publish", data: "data", connection: "connection", team: "team" };

const CAT: Record<ActivityItem["category"], { icon: LucideIcon; color: string }> = {
  run: { icon: Play, color: "var(--accent)" },
  agent: { icon: Bot, color: "var(--cat-create)" },
  content: { icon: FileText, color: "var(--cat-collect)" },
  publish: { icon: Send, color: "var(--cat-deliver)" },
  data: { icon: Database, color: "var(--cat-data)" },
  connection: { icon: Plug, color: "var(--cat-quality)" },
  team: { icon: Users, color: "var(--cat-assist)" },
  system: { icon: Info, color: "var(--muted)" },
};

const METRIC_LABEL: Record<string, string> = { items: "items", kept: "kept", removed: "removed", records: "records", created: "new", updated: "updated", skipped: "skipped", channels: "channels", manual: "to post by hand", failed: "failed", changed: "changed", images: "images" };

function dayLabel(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE d MMMM");
}

function minutesLabel(m: number) {
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  return `${h >= 10 ? Math.round(h) : h.toFixed(1)} h`;
}

function Row({ it, fresh }: { it: ActivityItem; fresh: boolean }) {
  const c = CAT[it.category] ?? CAT.system;
  const Icon = c.icon;
  const metrics = Object.entries(it.metrics ?? {}).filter(([, v]) => typeof v === "number" && v > 0);
  const body = (
    <div className={cn("flex gap-3.5 rounded-xl px-3 py-3 transition-colors", it.link && "hover:bg-surface-2/70", fresh && "animate-slide-in")}>
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ color: c.color, background: `color-mix(in oklab, ${c.color} 14%, var(--surface))` }}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className={cn("min-w-0 flex-1 text-[14px] leading-snug", it.level === "error" ? "text-bad" : "text-ink")}>{it.title}</p>
          {it.xp > 0 ? <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn tabular">+{it.xp} XP</span> : null}
        </div>
        {it.detail ? <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-2">{it.detail}</p> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
          <span className="tabular">{format(parseISO(it.at), "HH:mm")}</span>
          {it.actor ? <span>· {it.actor}</span> : null}
          {metrics.map(([k, v]) => (
            <span key={k} className={cn("rounded-full px-2 py-0.5", k === "failed" || k === "removed" ? "bg-surface-2 text-ink-2" : "bg-accent-soft text-accent")}>
              {num(v)} {METRIC_LABEL[k] ?? k.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
  return it.link ? <Link href={it.link}>{body}</Link> : body;
}

export default function ActivityPage() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [f, setF] = useState<F>("all");
  const [older, setOlder] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const category = FILTER_CATS[f];
  const feed = useQuery({
    queryKey: ["activity", ws.slug, f],
    queryFn: () => get<{ items: ActivityItem[]; next_cursor: string | null }>("/activity", { category, limit: 30 }),
    refetchInterval: 5000,
  });
  const progress = useQuery({ queryKey: ["progress", ws.slug], queryFn: () => get<WorkspaceProgress>("/progress"), refetchInterval: 15_000 });

  // reset paging when the filter changes
  useEffect(() => {
    setOlder([]);
    setCursor(undefined);
    seen.current = new Set();
  }, [f, ws.slug]);
  // mark newly arrived items so they slide in
  useEffect(() => {
    const items = feed.data?.items ?? [];
    if (cursor === undefined && feed.data) setCursor(feed.data.next_cursor);
    if (!seen.current.size) {
      items.forEach((i) => seen.current.add(i.id));
      return;
    }
    const fresh = items.filter((i) => !seen.current.has(i.id)).map((i) => i.id);
    if (fresh.length) {
      fresh.forEach((id) => seen.current.add(id));
      setFreshIds(new Set(fresh));
    }
  }, [feed.data, cursor]);
  // real mode: refresh instantly on live execution events (SSE), polling stays as a fallback
  useEffect(() => {
    if (isDemoMode() || typeof EventSource === "undefined") return;
    const es = new EventSource(apiUrl("/events/stream", { workspace: activeWorkspace() ?? undefined }), { withCredentials: true });
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        void qc.invalidateQueries({ queryKey: ["activity"] });
      }, 800);
    };
    es.onmessage = bump;
    for (const ty of ["run.finished", "run.failed", "run.awaiting_approval", "step.finished"]) es.addEventListener(ty, bump);
    es.onerror = () => es.close();
    return () => {
      es.close();
      if (t) clearTimeout(t);
    };
  }, [qc]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await get<{ items: ActivityItem[]; next_cursor: string | null }>("/activity", { category, limit: 30, before: cursor });
      r.items.forEach((i) => seen.current.add(i.id));
      setOlder((o) => [...o, ...r.items]);
      setCursor(r.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const items = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const i of [...(feed.data?.items ?? []), ...older]) if (!map.has(i.id)) map.set(i.id, i);
    return [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [feed.data, older]);
  const groups = useMemo(() => {
    const g: { day: string; items: ActivityItem[] }[] = [];
    for (const it of items) {
      const d = dayLabel(it.at);
      if (g[g.length - 1]?.day === d) g[g.length - 1].items.push(it);
      else g.push({ day: d, items: [it] });
    }
    return g;
  }, [items]);
  const p = progress.data;

  return (
    <div className="mx-auto max-w-[880px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">Activity</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">Everything your agents and your team did, as it happens.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-2">
          <span className="live-dot size-1.5 rounded-full bg-ok" /> Live
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Sparkles, label: "Items this week", value: p ? num(p.week.items) : "—" },
          { icon: Clock, label: "Time saved (estimated)", value: p ? minutesLabel(p.time_saved_minutes_week) : "—" },
          { icon: Target, label: "Success rate", value: p ? pct(p.week.success_rate) : "—" },
          { icon: Flame, label: "Streak", value: p ? `${p.streak_days} day${p.streak_days === 1 ? "" : "s"}` : "—" },
        ].map((s) => (
          <Card key={s.label} className="rounded-xl px-4 py-3.5">
            <p className="flex items-center gap-1.5 text-[12px] text-muted">
              <s.icon className="size-3.5" /> {s.label}
            </p>
            <p className="mt-1 text-[20px] font-semibold tracking-tight text-ink tabular">{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="mb-5">
        <FilterChips
          value={f}
          onChange={setF}
          options={[
            { value: "all", label: "All" },
            { value: "run", label: "Runs" },
            { value: "agent", label: "Agents" },
            { value: "content", label: "Content" },
            { value: "data", label: "Data" },
            { value: "connection", label: "Connections" },
            { value: "team", label: "Team" },
          ]}
        />
      </div>

      {feed.isError ? <ErrorState error={feed.error} onRetry={() => feed.refetch()} /> : null}
      {feed.isPending ? <Skeleton className="h-96 rounded-xl" /> : null}
      {feed.data && !items.length ? <p className="py-16 text-center text-[14px] text-muted">Nothing here yet. Run an agent and it shows up right away.</p> : null}

      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.day}>
            <h2 className="mb-2 px-1 text-[12px] font-semibold tracking-wide text-muted uppercase">{g.day}</h2>
            <Card className="rounded-2xl p-1.5">
              {g.items.map((it) => (
                <Row key={it.id} it={it} fresh={freshIds.has(it.id)} />
              ))}
            </Card>
          </section>
        ))}
      </div>
      {cursor ? (
        <div className="mt-6 text-center">
          <Button loading={loadingMore} onClick={loadMore}>
            Show older
          </Button>
        </div>
      ) : null}
    </div>
  );
}
