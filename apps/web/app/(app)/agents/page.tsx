"use client";

import { useQuery } from "@tanstack/react-query";
import { Pause, Play, Plus, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { agentStatus } from "@/components/platform/agent-utils";
import { AgentGlyph, Dot, Empty, FilterChips, SearchInput, categoryOf, formatEvery, usePermissions } from "@/components/platform/kit";
import { Badge, Button, ErrorState, PageHeader, Skeleton, cn } from "@/components/ui";
import { get, post } from "@/lib/api";
import { ago, pct, until } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { AgentsOverview, ManagedAgent } from "@/lib/platform-ops-types";
import type { PipelineRun } from "@/lib/platform-types";

function Strip({ o }: { o: AgentsOverview }) {
  const t = o.totals;
  const cells: { label: string; value: string | number; tone?: string; live?: boolean }[] = [
    { label: "Activated", value: t.activated },
    { label: "Running", value: t.running, live: t.running > 0 },
    { label: "Idle", value: t.idle },
    { label: "Scheduled", value: t.scheduled },
    { label: "Needs approval", value: t.awaiting_approval, tone: t.awaiting_approval ? "text-warn" : undefined },
    { label: "Failed · 24h", value: t.failed_24h, tone: t.failed_24h ? "text-bad" : undefined },
    { label: "Success · 7d", value: pct(t.success_rate_7d) },
  ];
  return (
    <div className="mb-8 grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface shadow-sm sm:grid-cols-4 lg:grid-cols-7">
      {cells.map((c, i) => (
        <div key={c.label} className={cn("border-line px-4 py-3.5", i > 0 && "border-l", i >= 2 && "max-sm:border-t", i >= 4 && "max-lg:border-t")}>
          <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
            {c.live ? <Dot tone="live" live /> : null}
            {c.label}
          </p>
          <p className={cn("mt-1 text-[22px] leading-none font-semibold tracking-tight text-ink tabular", c.tone)}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

export default function AgentsPage() {
  const router = useRouter();
  const perms = usePermissions();
  const [filter, setFilter] = useState<"all" | "running" | "paused" | "scheduled">("all");
  const [q, setQ] = useState("");
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => get<{ items: ManagedAgent[] }>("/agents"),
    refetchInterval: (qq) => (qq.state.data?.items.some((a) => a.live) ? 2000 : 8000),
  });
  const overview = useQuery({ queryKey: ["agents-overview"], queryFn: () => get<AgentsOverview>("/agents/overview"), refetchInterval: 5000 });
  const run = useAction((a: ManagedAgent) => post<PipelineRun>(`/agents/${a.id}/run`, {}), {
    success: (_r, a) => `${a.name} started`,
    invalidate: [["agents"], ["agents-overview"]],
  });
  const toggle = useAction((a: ManagedAgent) => post<ManagedAgent>(`/agents/${a.id}/${a.status === "paused" ? "resume" : "pause"}`), {
    success: (r) => `${r.name} ${r.status === "paused" ? "paused" : "resumed"}`,
    invalidate: [["agents"], ["agents-overview"]],
  });

  const items = agents.data?.items ?? [];
  const shown = items.filter(
    (a) =>
      (filter === "all" || (filter === "running" && a.live) || (filter === "paused" && a.status !== "active") || (filter === "scheduled" && a.schedule.every_minutes)) &&
      (!q || `${a.name} ${a.description} ${a.kind}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="My agents"
        subtitle="Chain any agents: collect → clean/sort → rewrite → save/publish. Start from the catalogue or build your own."
        actions={
          <>
            <Button icon={<Store className="size-3.5" />} onClick={() => router.push("/catalogue")}>
              Catalogue
            </Button>
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => router.push("/agents/new")} disabledReason={perms.reason("agents.manage")}>
              New agent
            </Button>
          </>
        }
      />
      {overview.data ? <Strip o={overview.data} /> : <Skeleton className="mb-8 h-[74px] rounded-xl" />}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: items.length },
            { value: "running", label: "Running", count: items.filter((a) => a.live).length },
            { value: "scheduled", label: "Scheduled", count: items.filter((a) => a.schedule.every_minutes).length },
            { value: "paused", label: "Paused", count: items.filter((a) => a.status !== "active").length },
          ]}
        />
        <SearchInput value={q} onChange={setQ} placeholder="Search agents" className="ml-auto w-full sm:w-64" />
      </div>

      {agents.isError ? <ErrorState error={agents.error} onRetry={() => agents.refetch()} /> : null}
      {agents.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[176px] rounded-xl" />
          ))}
        </div>
      ) : null}
      {agents.data && !items.length ? (
        <Empty
          icon={<Store />}
          title="No agents yet"
          body="Activate ready-made agents from the catalogue, or build your own from any agent type."
          action={
            <Button variant="primary" onClick={() => router.push("/catalogue")}>
              Browse the catalogue
            </Button>
          }
        />
      ) : null}
      {agents.data && items.length > 0 && !shown.length ? <Empty title="No agents match" body="Clear the filter or search." /> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((a) => {
          const st = agentStatus(a);
          return (
            <div key={a.id} className="group relative flex flex-col rounded-xl border border-line bg-surface p-5 shadow-sm transition-all hover:border-line-strong hover:shadow-md">
              <Link href={`/agents/${a.id}`} className="absolute inset-0 rounded-xl" aria-label={`Open ${a.name}`} />
              <div className="flex items-start gap-3">
                <AgentGlyph kind={a.kind} category={categoryOf(a.kind)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{a.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-2">
                    <Dot tone={st.tone} live={st.tone === "live"} /> {st.label}
                    <span className="text-muted">· v{a.version}</span>
                    {a.source === "platform" ? <Badge className="ml-1">Catalogue</Badge> : null}
                  </p>
                </div>
              </div>
              <p className={cn("mt-3 line-clamp-2 min-h-[36px] text-[12.5px] leading-relaxed", a.live ? "text-accent" : "text-ink-2")}>{a.live ? (a.live.message ?? "Working…") : a.description || "No description"}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11.5px]">
                <div>
                  <dt className="text-muted">Last run</dt>
                  <dd className="mt-0.5 truncate text-ink">{ago(a.stats.last_run_at, "Never")}</dd>
                </div>
                <div>
                  <dt className="text-muted">Next run</dt>
                  <dd className="mt-0.5 truncate text-ink" title={formatEvery(a.schedule.every_minutes)}>
                    {a.schedule.next_run_at ? until(a.schedule.next_run_at) : a.schedule.every_minutes ? "Paused" : "On demand"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Success</dt>
                  <dd className="mt-0.5 text-ink tabular">{pct(a.stats.success_rate)}</dd>
                </div>
              </dl>
              <div className="relative z-[1] mt-4 flex gap-2">
                <Button size="xs" variant="secondary" icon={<Play className="size-3" />} loading={run.isPending && run.variables?.id === a.id} disabledReason={a.status !== "active" ? `Agent is ${a.status}` : perms.reason("agents.run")} onClick={() => run.mutate(a)}>
                  Run
                </Button>
                {a.status !== "disabled" ? (
                  <Button size="xs" variant="ghost" icon={a.status === "paused" ? <Play className="size-3" /> : <Pause className="size-3" />} loading={toggle.isPending && toggle.variables?.id === a.id} disabledReason={perms.reason("agents.run")} onClick={() => toggle.mutate(a)}>
                    {a.status === "paused" ? "Resume" : "Pause"}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
