"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, CircleDashed, FileText, Loader2, RotateCcw, SkipForward, Square, ThumbsDown, ThumbsUp, UserCheck, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { FlowLine, flowState } from "@/components/platform/flow";
import { AgentGlyph, KeyValue, StatusPill, categoryOf, usePermissions } from "@/components/platform/kit";
import { Banner, Button, Card, Dialog, ErrorState, Field, Skeleton, Textarea, cn } from "@/components/ui";
import { get, post } from "@/lib/api";
import { ago, dateTime, ms } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { ContentItem, Paged, PipelineRun, RunStep } from "@/lib/platform-types";

const ACTIVE = ["queued", "running", "awaiting_approval"];

function StepIcon({ s }: { s: RunStep }) {
  const base = "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-bg";
  if (s.status === "succeeded")
    return (
      <span className={cn(base, "bg-ok text-white")}>
        <Check className="size-4" strokeWidth={2.6} />
      </span>
    );
  if (s.status === "failed")
    return (
      <span className={cn(base, "bg-bad text-white")}>
        <X className="size-4" strokeWidth={2.6} />
      </span>
    );
  if (s.status === "running")
    return (
      <span className={cn(base, s.type === "approval" ? "bg-warn text-white" : "bg-accent-solid text-accent-ink")}>
        {s.type === "approval" ? <UserCheck className="size-4" /> : <Loader2 className="size-4 animate-spin" />}
      </span>
    );
  if (s.status === "skipped")
    return (
      <span className={cn(base, "border border-line-strong bg-surface text-muted")}>
        <SkipForward className="size-3.5" />
      </span>
    );
  return (
    <span className={cn(base, "border border-dashed border-line-strong bg-surface text-muted")}>
      <CircleDashed className="size-3.5" />
    </span>
  );
}

function StepRow({ s, next, last, open, onToggle, approvalActions }: { s: RunStep; next?: RunStep; last: boolean; open: boolean; onToggle: () => void; approvalActions?: ReactNode }) {
  const isApproval = s.type === "approval" || s.kind === "approval";
  return (
    <li className="relative flex gap-4">
      {!last ? (
        <span className="absolute top-9 bottom-0 left-[15px] w-[2px]">
          <FlowLine state={flowState(s, next)} className="absolute inset-0" />
        </span>
      ) : null}
      <StepIcon s={s} />
      <div className="min-w-0 flex-1 pb-6">
        <button type="button" onClick={onToggle} className={cn("w-full rounded-xl border bg-surface p-4 text-left shadow-sm transition-colors hover:border-line-strong", s.status === "running" && !isApproval ? "pulse-soft border-accent/40" : isApproval && s.status === "running" ? "border-warn/50" : "border-line")}>
          <div className="flex items-center gap-3">
            <AgentGlyph kind={isApproval ? "approval" : s.kind} category={isApproval ? "approval" : categoryOf(s.kind)} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-ink">{s.label || s.agent_name}</p>
              <p className="truncate text-[12px] text-muted">
                {isApproval ? "Human approval" : s.kind.replace(/_/g, " ")}
                {s.attempts && s.attempts > 1 ? ` · ${s.attempts} attempts` : ""}
              </p>
            </div>
            {!isApproval ? (
              <span className="hidden text-right text-[12px] text-ink-2 tabular sm:block">
                {s.items_in} → <strong className="font-semibold text-ink">{s.items_out}</strong> items
                <span className="block text-[11px] text-muted">{s.duration_ms !== null ? ms(s.duration_ms) : s.status === "running" ? "running…" : "—"}</span>
              </span>
            ) : null}
            <StatusPill status={isApproval && s.status === "running" ? "awaiting_approval" : s.status} />
            <ChevronRight className={cn("size-4 text-muted transition-transform", open && "rotate-90")} />
          </div>
          {s.status === "running" && !isApproval && s.logs.length ? <p className="mt-2 truncate pl-10 text-[12.5px] text-accent">{s.logs[s.logs.length - 1].message}</p> : null}
          {s.error ? <p className="mt-2 pl-10 text-[12.5px] text-bad">{s.error}</p> : null}
        </button>
        {approvalActions}
        {open ? (
          <div className="mt-2 rounded-xl border border-line bg-surface-2/60 p-3">
            {s.logs.length ? (
              <ol className="space-y-1 font-mono text-[12px]">
                {s.logs.map((l, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="shrink-0 text-muted tabular">{dateTime(l.at, "HH:mm:ss")}</span>
                    <span className={l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : "text-ink-2"}>{l.message}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12.5px] text-muted">{s.status === "pending" ? "Waiting for earlier steps." : s.status === "skipped" ? "Skipped: its condition was not met or the agent is paused." : "No logs."}</p>
            )}
            {s.started_at ? (
              <p className="mt-2 text-[11.5px] text-muted">
                Started {dateTime(s.started_at, "HH:mm:ss")}
                {s.finished_at ? ` · finished ${dateTime(s.finished_at, "HH:mm:ss")}` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const perms = usePermissions();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const run = useQuery({
    queryKey: ["run", id],
    queryFn: () => get<PipelineRun>(`/runs/${id}`),
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 2000 : q.state.data?.status === "awaiting_approval" ? 5000 : false),
  });
  const r = run.data;
  const drafts = useQuery({
    queryKey: ["content", "run", id],
    queryFn: () => get<Paged<ContentItem>>("/content", { limit: 100 }),
    enabled: Boolean(r && (r.status === "awaiting_approval" || r.content_created)),
    select: (d) => d.items.filter((c) => c.run_id === id),
  });
  // auto-open the running step
  useEffect(() => {
    const running = r?.steps.find((s) => s.status === "running" && s.type !== "approval");
    if (running) setOpen((o) => (o[running.step_id] === undefined ? { ...o, [running.step_id]: true } : o));
  }, [r]);
  const inv = [["run", id], ["runs"], ["content"], ["notifications"], ["workspace-dashboard"]];
  const approve = useAction(() => post<PipelineRun>(`/runs/${id}/approve`, {}), { success: "Approved, publishing now", invalidate: inv });
  const reject = useAction(() => post<PipelineRun>(`/runs/${id}/reject`, { reason }), { success: "Rejected", invalidate: inv, onSuccess: () => setRejecting(false) });
  const cancel = useAction(() => post<PipelineRun>(`/runs/${id}/cancel`), { success: "Run cancelled", invalidate: inv });
  const again = useAction(() => (r?.pipeline_id ? post<PipelineRun>(`/pipelines/${r.pipeline_id}/run`, {}) : post<PipelineRun>(`/agents/${r?.agent_id ?? r?.steps[0]?.agent_id}/run`, {})), {
    success: "New run started",
    invalidate: [["runs"]],
    onSuccess: (n) => router.push(`/runs/${n.id}`),
  });

  if (run.isError) return <ErrorState error={run.error} onRetry={() => run.refetch()} />;
  if (!r)
    return (
      <div className="mx-auto max-w-[1100px] space-y-4">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  const done = r.steps.filter((s) => s.status === "succeeded" || s.status === "skipped").length;
  const pctDone = r.steps.length ? Math.round((done / r.steps.length) * 100) : 0;
  const awaiting = r.status === "awaiting_approval";
  const approvalButtons = (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" icon={<ThumbsUp className="size-3.5" />} loading={approve.isPending} onClick={() => approve.mutate(undefined)} disabledReason={perms.reason("content.approve")}>
        Approve &amp; continue
      </Button>
      <Button icon={<ThumbsDown className="size-3.5" />} onClick={() => setRejecting(true)} disabledReason={perms.reason("content.approve")}>
        Reject
      </Button>
    </div>
  );
  const sourceHref = r.pipeline_id ? `/pipelines/${r.pipeline_id}` : r.agent_id || r.steps[0]?.agent_id ? `/agents/${r.agent_id ?? r.steps[0].agent_id}` : null;

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href="/runs" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Runs
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-[24px] font-semibold tracking-tight text-ink">{r.pipeline_name}</h1>
            <StatusPill status={r.status} />
          </div>
          <p className="mt-1 text-[13px] text-ink-2">
            Run <span className="font-mono text-[12px]">{r.id.slice(0, 12)}</span> · {r.trigger} · started {ago(r.started_at ?? r.created_at)}
            {sourceHref ? (
              <>
                {" · "}
                <Link href={sourceHref} className="text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent">
                  {r.pipeline_id ? "open workflow" : "open agent"}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          {ACTIVE.includes(r.status) ? (
            <Button icon={<Square className="size-3.5" />} loading={cancel.isPending} onClick={() => cancel.mutate(undefined)} disabledReason={perms.reason("agents.run")}>
              Cancel
            </Button>
          ) : (
            <Button icon={<RotateCcw className="size-3.5" />} loading={again.isPending} onClick={() => again.mutate(undefined)} disabledReason={perms.reason("agents.run")}>
              Run again
            </Button>
          )}
        </div>
      </div>

      {awaiting ? (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-warn/40 bg-warn-soft px-5 py-4">
          <UserCheck className="size-5 text-warn" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">Waiting for your approval</p>
            <p className="text-[12.5px] text-ink-2">
              {drafts.data?.length ? `${drafts.data.length} draft${drafts.data.length === 1 ? "" : "s"} ready. Review them, then approve to publish.` : "Approve to let the remaining steps run."}
            </p>
          </div>
          {approvalButtons}
        </div>
      ) : null}
      {r.status === "failed" && r.error ? (
        <Banner tone="bad" title="This run failed" className="mb-6">
          {r.error}
        </Banner>
      ) : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="mb-5 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className={cn("h-full rounded-full transition-all duration-700", r.status === "failed" ? "bg-bad" : r.status === "succeeded" ? "bg-ok" : "bg-accent")} style={{ width: `${pctDone}%` }} />
            </div>
            <span className="text-[12px] text-muted tabular">
              {done}/{r.steps.length} steps
            </span>
          </div>
          <ol>
            {r.steps.map((s, i) => (
              <StepRow
                key={s.step_id}
                s={s}
                next={r.steps[i + 1]}
                last={i === r.steps.length - 1}
                open={Boolean(open[s.step_id])}
                onToggle={() => setOpen((o) => ({ ...o, [s.step_id]: !o[s.step_id] }))}
                approvalActions={(s.type === "approval" || s.kind === "approval") && s.status === "running" && awaiting ? <div className="mt-2">{approvalButtons}</div> : undefined}
              />
            ))}
          </ol>
        </div>
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5">
            <p className="mb-3 text-[13px] font-semibold text-ink">Summary</p>
            <KeyValue
              items={[
                { label: "Status", value: <StatusPill status={r.status} /> },
                { label: "Trigger", value: <span className="capitalize">{r.trigger}</span> },
                { label: "Started", value: dateTime(r.started_at) },
                { label: "Finished", value: dateTime(r.finished_at) },
                { label: "Duration", value: ms(r.duration_ms) },
                { label: "Items out", value: r.items_out },
                { label: "Content", value: r.content_created },
              ]}
            />
          </Card>
          {drafts.data?.length ? (
            <Card className="p-5">
              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <FileText className="size-3.5 text-muted" /> Content from this run
              </p>
              <ul className="-mx-2">
                {drafts.data.map((c) => (
                  <li key={c.id}>
                    <Link href={`/content/${c.id}`} className="block rounded-lg px-2 py-2 hover:bg-surface-2">
                      <span className="line-clamp-2 text-[12.5px] text-ink">{c.title}</span>
                      <span className="mt-1 block">
                        <StatusPill status={c.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      <Dialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        size="sm"
        title="Reject this run?"
        description="Drafts are marked rejected and nothing is published."
        footer={
          <>
            <Button onClick={() => setRejecting(false)}>Cancel</Button>
            <Button variant="danger" loading={reject.isPending} onClick={() => reject.mutate(undefined)}>
              Reject
            </Button>
          </>
        }
      >
        <Field label="Reason" hint="Optional: helps tune the agents">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
