"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock, Hand, Play, Plus, Store, Webhook, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentGlyph, Empty, StatusPill, categoryOf, formatEvery, usePermissions } from "@/components/platform/kit";
import { Button, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { get, post } from "@/lib/api";
import { ago, until } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Pipeline, PipelineRun } from "@/lib/platform-types";

export default function PipelinesPage() {
  const router = useRouter();
  const perms = usePermissions();
  const q = useQuery({ queryKey: ["pipelines"], queryFn: () => get<{ items: Pipeline[] }>("/pipelines"), refetchInterval: 8000 });
  const run = useAction((p: Pipeline) => post<PipelineRun>(`/pipelines/${p.id}/run`, {}), {
    success: (_r, p) => `${p.name} started`,
    invalidate: [["pipelines"], ["runs"]],
    onSuccess: (r) => router.push(`/runs/${r.id}`),
  });
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Workflows"
        subtitle="Agents chained step by step. Each step hands its items to the next."
        actions={
          <>
            <Button icon={<Store className="size-3.5" />} onClick={() => router.push("/catalogue")}>
              Agent catalogue
            </Button>
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => router.push("/pipelines/new")} disabledReason={perms.reason("agents.manage")}>
              New workflow
            </Button>
          </>
        }
      />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[108px] rounded-xl" />
          ))}
        </div>
      ) : null}
      {q.data && !q.data.items.length ? (
        <Empty
          icon={<Workflow />}
          title="No workflows yet"
          body="Chain agents into a workflow: collect → clean → write → publish. Activate the agents you need from the catalogue first."
          action={
            <div className="flex gap-2">
              <Button onClick={() => router.push("/catalogue")}>Browse agents</Button>
              <Button variant="primary" onClick={() => router.push("/pipelines/new")}>
                New workflow
              </Button>
            </div>
          }
        />
      ) : null}
      <div className="space-y-3">
        {q.data?.items.map((p) => {
          const agentSteps = p.steps.filter((s) => s.type !== "approval");
          return (
            <div key={p.id} className="group relative rounded-xl border border-line bg-surface p-5 shadow-sm transition-all hover:border-line-strong hover:shadow-md">
              <Link href={`/pipelines/${p.id}`} className="absolute inset-0 rounded-xl" aria-label={`Open ${p.name}`} />
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[15px] font-semibold text-ink">{p.name}</p>
                    {!p.enabled ? <StatusPill status="paused" label="Off" /> : null}
                  </div>
                  {p.description ? <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-2">{p.description}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-1">
                    {p.steps.map((s, i) => (
                      <span key={s.id} className="inline-flex items-center gap-1">
                        {i > 0 ? <ChevronRight className="size-3 text-line-strong" /> : null}
                        <span title={s.type === "approval" ? "Approval" : s.agent_name}>
                          {s.type === "approval" ? <AgentGlyph kind="approval" category="approval" size="sm" /> : <AgentGlyph kind={s.kind} category={categoryOf(s.kind)} size="sm" />}
                        </span>
                      </span>
                    ))}
                    <span className="ml-2 text-xs text-muted">
                      {agentSteps.length} agents
                      {p.require_approval ? " · approval before publishing" : ""}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                    {p.trigger.type === "schedule" ? <Clock className="size-3.5" /> : p.trigger.type === "webhook" ? <Webhook className="size-3.5" /> : <Hand className="size-3.5" />}
                    {p.trigger.type === "schedule" ? formatEvery(p.trigger.every_minutes) : p.trigger.type === "webhook" ? "Webhook" : "Manual"}
                    {p.next_run_at ? <span className="text-muted">· next {until(p.next_run_at)}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {p.last_run ? (
                      <>
                        <StatusPill status={p.last_run.status} /> {ago(p.last_run.started_at ?? p.last_run.finished_at)}
                      </>
                    ) : (
                      "Never run"
                    )}
                  </span>
                  <Button
                    size="xs"
                    className="relative z-[1]"
                    icon={<Play className="size-3" />}
                    loading={run.isPending && run.variables?.id === p.id}
                    disabledReason={!p.enabled ? "Workflow is turned off" : perms.reason("agents.run")}
                    onClick={() => run.mutate(p)}
                  >
                    Run now
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
