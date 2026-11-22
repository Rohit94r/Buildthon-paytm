"use client";

import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Empty, FilterChips, StatusPill } from "@/components/platform/kit";
import { Card, ErrorState, PageHeader, SkeletonRows, cn, td, th } from "@/components/ui";
import { get } from "@/lib/api";
import { ago, dateTime, ms } from "@/lib/format";
import type { Pipeline, PipelineRun, RunStatus } from "@/lib/platform-types";

type F = "all" | RunStatus;

function Runs() {
  const router = useRouter();
  const params = useSearchParams();
  const pipelineId = params.get("pipeline_id") ?? undefined;
  const [f, setF] = useState<F>("all");
  const runs = useQuery({
    queryKey: ["runs", pipelineId ?? "all"],
    queryFn: () => get<{ items: PipelineRun[] }>("/runs", { pipeline_id: pipelineId, limit: 100 }),
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === "queued" || r.status === "running") ? 2000 : 10_000),
  });
  const pipes = useQuery({ queryKey: ["pipelines"], queryFn: () => get<{ items: Pipeline[] }>("/pipelines"), enabled: Boolean(pipelineId) });
  const items = runs.data?.items ?? [];
  const shown = items.filter((r) => f === "all" || r.status === f);
  const count = (s: RunStatus) => items.filter((r) => r.status === s).length;
  const pName = pipes.data?.items.find((p) => p.id === pipelineId)?.name;
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Runs" subtitle={pName ? `Runs of ${pName}` : "Every workflow and agent run, newest first."} />
      <div className="mb-4">
        <FilterChips
          value={f}
          onChange={setF}
          options={[
            { value: "all", label: "All", count: items.length },
            { value: "running", label: "Running", count: count("running") + count("queued") },
            { value: "awaiting_approval", label: "Needs approval", count: count("awaiting_approval") },
            { value: "succeeded", label: "Succeeded", count: count("succeeded") },
            { value: "failed", label: "Failed", count: count("failed") },
          ]}
        />
      </div>
      {runs.isError ? <ErrorState error={runs.error} onRetry={() => runs.refetch()} /> : null}
      {runs.isPending ? (
        <Card>
          <SkeletonRows rows={8} />
        </Card>
      ) : null}
      {runs.data && !shown.length ? <Empty icon={<Play />} title="No runs here" body="Run a workflow or an agent and it shows up here, live." /> : null}
      {shown.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Status</th>
                <th className={th}>Workflow</th>
                <th className={cn(th, "hidden md:table-cell")}>Progress</th>
                <th className={cn(th, "text-right")}>Output</th>
                <th className={cn(th, "text-right")}>Duration</th>
                <th className={th}>Started</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const done = r.steps.filter((s) => s.status === "succeeded" || s.status === "skipped").length;
                return (
                  <tr key={r.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => router.push(`/runs/${r.id}`)}>
                    <td className={td}>
                      <StatusPill status={r.status} />
                    </td>
                    <td className={cn(td, "max-w-[300px]")}>
                      <span className="block truncate font-medium text-ink">{r.pipeline_name}</span>
                      <span className="text-[11.5px] text-muted capitalize">{r.trigger}</span>
                    </td>
                    <td className={cn(td, "hidden md:table-cell")}>
                      <div className="flex items-center gap-1" aria-label={`${done} of ${r.steps.length} steps done`}>
                        {r.steps.map((s) => (
                          <span
                            key={s.step_id}
                            className={cn(
                              "h-1.5 w-5 rounded-full",
                              s.status === "succeeded" ? "bg-ok" : s.status === "failed" ? "bg-bad" : s.status === "running" ? "animate-pulse bg-accent" : s.status === "skipped" ? "bg-line-strong" : "bg-surface-3",
                            )}
                          />
                        ))}
                      </div>
                    </td>
                    <td className={cn(td, "text-right text-ink-2 tabular")}>
                      {r.items_out} items
                      {r.content_created ? <span className="block text-[11.5px] text-muted">{r.content_created} content</span> : null}
                    </td>
                    <td className={cn(td, "text-right text-ink-2 tabular")}>{ms(r.duration_ms)}</td>
                    <td className={cn(td, "text-muted")} title={dateTime(r.created_at)}>
                      {ago(r.started_at ?? r.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}

export default function RunsPage() {
  return (
    <Suspense fallback={null}>
      <Runs />
    </Suspense>
  );
}
