"use client";

import { useQuery } from "@tanstack/react-query";
import { Cpu, Server } from "lucide-react";
import { Kpi, StatusPill } from "@/components/platform/kit";
import { Card, ErrorState, PageHeader, Skeleton, cn } from "@/components/ui";
import { get } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import type { PlatformHealth } from "@/lib/platform-ops-types";

export default function HealthPage() {
  const q = useQuery({ queryKey: ["platform-health"], queryFn: () => get<PlatformHealth>("/platform/health"), refetchInterval: 10_000 });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data;
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Health" subtitle="Queue, workers, model and errors across the platform. Refreshes every 10 seconds." />
      {!h ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Running" value={h.queue.running} hint={`${h.queue.queued} queued`} />
            <Kpi label="Oldest queued" value={h.queue.oldest_queued_age_s === null ? "—" : `${h.queue.oldest_queued_age_s}s`} hint="Wait before a worker picks it up" />
            <Kpi label="Failed · 24h" value={h.queue.failed_24h} tone={h.queue.failed_24h ? "bad" : "ok"} />
            <Kpi label="Dead jobs" value={h.queue.dead} tone={h.queue.dead ? "bad" : undefined} hint="Gave up after retries" />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                  <Cpu className="size-4 text-muted" /> Model
                </p>
                <StatusPill status={h.model.status === "ok" ? "active" : h.model.status === "degraded" ? "paused" : "failed"} label={h.model.status === "ok" ? "Healthy" : h.model.status} />
              </div>
              <p className="text-[13px] text-ink-2">
                Provider <span className="font-mono text-ink">{h.provider}</span>
              </p>
              {h.model.detail ? <p className="mt-1 text-[12.5px] text-muted">{h.model.detail}</p> : null}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {h.model.models.map((m) => (
                  <span key={m} className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-ink-2">
                    {m}
                  </span>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <p className="mb-4 flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                <Server className="size-4 text-muted" /> Workers
              </p>
              {h.workers.length ? (
                <ul className="space-y-2.5">
                  {h.workers.map((w) => {
                    const fresh = Date.now() - new Date(w.last_seen).getTime() < 60_000;
                    return (
                      <li key={w.id} className="flex items-center gap-3 text-[13px]">
                        <span className={cn("size-2 rounded-full", fresh ? "live-dot bg-ok" : "bg-warn")} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{w.id}</span>
                        <span className="text-[12px] text-ink-2">{w.running} running</span>
                        <span className="w-24 text-right text-[11.5px] text-muted">{ago(w.last_seen)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[13px] text-bad">No worker heartbeat. Start a worker to process runs.</p>
              )}
            </Card>
          </div>
          <Card className="p-5">
            <p className="mb-3 text-[13.5px] font-semibold text-ink">Errors · last 24h</p>
            {h.errors_24h.length ? (
              <ul className="divide-y divide-line">
                {h.errors_24h.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-[13px]">
                    <span className="w-32 shrink-0 text-[12px] text-muted" title={dateTime(e.at)}>
                      {ago(e.at)}
                    </span>
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2">{e.workspace}</span>
                    <span className="min-w-0 flex-1 text-bad">{e.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No errors in the last 24 hours.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
