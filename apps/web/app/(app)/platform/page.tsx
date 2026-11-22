"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Cpu } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RunsChart } from "@/components/platform/charts";
import { Kpi } from "@/components/platform/kit";
import { Card, ErrorState, PageHeader, Skeleton, cn } from "@/components/ui";
import { get } from "@/lib/api";
import { ago, num } from "@/lib/format";
import type { PlatformOverview, Workspace } from "@/lib/platform-types";
import { industryLabel, useSwitchWorkspace } from "@/lib/workspace";

export default function PlatformPage() {
  const router = useRouter();
  const switchTo = useSwitchWorkspace();
  const q = useQuery({ queryKey: ["platform-overview"], queryFn: () => get<PlatformOverview>("/platform/overview"), refetchInterval: 15_000 });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Platform" subtitle="Every client workspace at a glance." />
      {!o ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Clients" value={num(o.totals.workspaces)} hint={`${o.totals.agents} agents · ${o.totals.pipelines} workflows`} />
            <Kpi label="Runs · 24h" value={num(o.totals.runs_24h)} hint={o.totals.failed_24h ? `${o.totals.failed_24h} failed` : "No failures"} tone={o.totals.failed_24h ? undefined : "ok"} />
            <Kpi label="Content · 7d" value={num(o.totals.content_7d)} hint={`${o.totals.published_7d} published`} />
            <Kpi label="Queue" value={`${o.queue.running} / ${o.queue.queued}`} hint="running / queued" />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 [&>*]:min-w-0">
            <Card className="p-5 lg:col-span-2">
              <p className="mb-3 text-[13.5px] font-semibold text-ink">Runs across all clients · 14 days</p>
              <RunsChart data={o.runs_by_day} height={220} />
            </Card>
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13.5px] font-semibold text-ink">Models</p>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-ink-2">{o.provider}</span>
              </div>
              <ul className="space-y-3">
                {o.models.map((m) => (
                  <li key={m.name} className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-surface-2 text-muted">
                      <Cpu className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] text-ink">{m.name}</span>
                      <span className="text-[11.5px] text-muted capitalize">
                        {m.role}
                        {m.size_gb ? ` · ${m.size_gb} GB` : ""}
                      </span>
                    </span>
                    <span className={cn("inline-flex items-center gap-1.5 text-[11.5px]", m.loaded ? "text-ok" : "text-muted")}>
                      <span className={cn("size-1.5 rounded-full", m.loaded ? "bg-ok" : "bg-line-strong")} />
                      {m.loaded ? "Loaded" : "Idle"}
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/platform/health" className="mt-4 inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-accent">
                System health <ArrowRight className="size-3.5" />
              </Link>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 [&>*]:min-w-0">
            <Card className="lg:col-span-2">
              <div className="flex items-center justify-between px-5 pt-4 pb-2">
                <p className="text-[13.5px] font-semibold text-ink">Clients</p>
                <Link href="/clients" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-accent">
                  Manage <ArrowRight className="size-3.5" />
                </Link>
              </div>
              <ul className="px-3 pb-3">
                {o.workspaces.map((w: Workspace & { plan?: string; status?: string }) => (
                  <li key={w.slug}>
                    <button type="button" onClick={() => switchTo(w.slug)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-surface-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold text-white" style={{ background: w.brand_color }}>
                        {w.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{w.name}</span>
                        <span className="block truncate text-[11.5px] text-muted">
                          {industryLabel(w.industry)}
                          {w.plan ? ` · ${w.plan}` : ""}
                          {w.status === "suspended" ? " · suspended" : ""}
                        </span>
                      </span>
                      <span className="hidden text-right text-[12px] text-ink-2 tabular sm:block">
                        {w.stats.runs_24h} runs
                        {w.stats.failed_24h ? <span className="text-bad"> · {w.stats.failed_24h} failed</span> : null}
                        <span className="block text-[11px] text-muted">{w.stats.content_7d} content · 7d</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <p className="mb-3 text-[13.5px] font-semibold text-ink">Across clients</p>
              <ul className="space-y-3">
                {o.activity.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex gap-2.5">
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", a.status === "error" ? "bg-bad" : a.status === "warn" ? "bg-warn" : a.status === "ok" ? "bg-ok" : "bg-muted")} />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] leading-snug text-ink-2">{a.message}</span>
                      <span className="text-[11px] text-muted">
                        {a.workspace_name} · {ago(a.at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => router.push("/clients?new=1")} className="mt-5 w-full rounded-lg border border-dashed border-line-strong py-2.5 text-[12.5px] font-medium text-ink-2 hover:border-accent hover:text-accent">
                + New client workspace
              </button>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
