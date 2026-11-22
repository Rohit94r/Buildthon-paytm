"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Clock, Filter, Hand, History, Play, Plus, Save, Search, Trash2, Webhook, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FlowLine, flowLabel, flowState, type FlowState } from "@/components/platform/flow";
import { AgentGlyph, CATEGORY_META, CopyField, StatusPill, categoryOf, formatEvery, usePermissions } from "@/components/platform/kit";
import { Badge, Button, Card, Dialog, ErrorState, Input, Select, Skeleton, Toggle, cn } from "@/components/ui";
import { del, get, patch, post } from "@/lib/api";
import { ago } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { ManagedAgent, PipelineVersion, StepCondition } from "@/lib/platform-ops-types";
import type { AgentType, Pipeline, PipelineRun, RunStep } from "@/lib/platform-types";

interface DraftStep {
  key: string;
  id?: string;
  type: "agent" | "approval";
  agent_id: string | null;
  label: string;
  condition: StepCondition | null;
  on_error: "stop" | "continue" | "retry";
  retries: number;
}

const COND_OPS: { value: StepCondition["op"]; label: string; needsValue: boolean }[] = [
  { value: "gt", label: ">", needsValue: true },
  { value: "gte", label: "≥", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "lte", label: "≤", needsValue: true },
  { value: "eq", label: "equals", needsValue: true },
  { value: "neq", label: "is not", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "not_contains", label: "doesn't contain", needsValue: true },
  { value: "exists", label: "exists", needsValue: false },
  { value: "not_empty", label: "is not empty", needsValue: false },
  { value: "empty", label: "is empty", needsValue: false },
];

let seq = 0;
const key = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

function toDraft(p: Pipeline): DraftStep[] {
  return p.steps.map((s) => ({
    key: key(),
    id: s.id,
    type: s.type === "approval" ? "approval" : "agent",
    agent_id: s.agent_id ?? null,
    label: s.label ?? "",
    condition: s.condition ?? null,
    on_error: s.on_error ?? "stop",
    retries: s.retries ?? 1,
  }));
}

function Connector({ onAdd, disabled, state = "idle", label }: { onAdd: () => void; disabled?: boolean; state?: FlowState; label?: string | null }) {
  return (
    <div className="group relative flex h-12 justify-center">
      <FlowLine state={state} label={label} className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2" />
      <ArrowDown className={cn("absolute bottom-0 size-3 translate-y-[3px]", state === "done" ? "text-ok" : state === "failed" ? "text-bad" : state === "running" ? "text-accent" : "text-line-strong")} aria-hidden />
      {!disabled ? (
        <button type="button" onClick={onAdd} className="relative z-[1] mt-2 flex size-6 items-center justify-center rounded-full border border-line bg-surface text-muted opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-accent focus:opacity-100" aria-label="Insert a step here">
          <Plus className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function StepCard({
  step,
  index,
  total,
  agent,
  type,
  onChange,
  onMove,
  onRemove,
  readOnly,
  live,
}: {
  live?: RunStep;
  step: DraftStep;
  index: number;
  total: number;
  agent?: ManagedAgent;
  type?: AgentType;
  onChange: (s: DraftStep) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  readOnly: boolean;
}) {
  const [advanced, setAdvanced] = useState(Boolean(step.condition) || step.on_error !== "stop");
  const cat = step.type === "approval" ? "approval" : categoryOf(agent?.kind, type ? [type] : undefined);
  const color = CATEGORY_META[cat].color;
  const op = COND_OPS.find((o) => o.value === step.condition?.op);
  return (
    <div className={cn("animate-in relative overflow-hidden rounded-xl border bg-surface shadow-sm", live?.status === "running" ? "pulse-soft border-accent/50" : live?.status === "failed" ? "border-bad/40" : "border-line")}>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} aria-hidden />
      <div className="flex items-start gap-3 py-4 pr-4 pl-5">
        <AgentGlyph kind={step.type === "approval" ? "approval" : agent?.kind} icon={type?.icon} category={cat} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-muted tabular">Step {index + 1}</span>
            <span className="text-[11px] font-medium" style={{ color }}>
              {CATEGORY_META[cat].label}
            </span>
            {step.condition ? (
              <Badge tone="info">
                <Filter className="size-3" /> conditional
              </Badge>
            ) : null}
            {step.on_error !== "stop" ? <Badge>{step.on_error === "retry" ? `retry ×${step.retries}` : "continue on error"}</Badge> : null}
            {live && live.status !== "pending" ? <StatusPill status={live.type === "approval" && live.status === "running" ? "awaiting_approval" : live.status} className="ml-auto" /> : null}
          </div>
          <p className="mt-0.5 truncate text-[14px] font-semibold text-ink">{step.type === "approval" ? step.label || "Human approval" : (step.label || agent?.name) ?? "Unknown agent"}</p>
          <p className="truncate text-[12.5px] text-ink-2">
            {step.type === "approval" ? "Pauses the run until someone approves it in the dashboard." : step.label && agent ? `${agent.name} · ${type?.name ?? agent.kind}` : (type?.name ?? agent?.kind ?? "This agent was deleted")}
            {agent && agent.status !== "active" ? <span className="text-warn"> · {agent.status}: this step will be skipped</span> : null}
          </p>
        </div>
        {!readOnly ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconBtn label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="size-3.5" />
            </IconBtn>
            <IconBtn label="Move down" disabled={index === total - 1} onClick={() => onMove(1)}>
              <ArrowDown className="size-3.5" />
            </IconBtn>
            <IconBtn label="Remove step" onClick={onRemove}>
              <Trash2 className="size-3.5" />
            </IconBtn>
          </div>
        ) : null}
      </div>
      {!readOnly ? (
        <div className="border-t border-line bg-surface-2/40 px-5 py-2.5">
          {!advanced ? (
            <button type="button" onClick={() => setAdvanced(true)} className="text-[12px] text-muted hover:text-ink">
              Label, condition &amp; error handling…
            </button>
          ) : (
            <div className="space-y-3 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-[12px] text-muted">Label</span>
                <Input className="h-8 max-w-xs" value={step.label} placeholder={step.type === "approval" ? "Editor approval" : agent?.name} onChange={(e) => onChange({ ...step, label: e.target.value })} />
              </div>
              {step.type === "agent" ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-24 text-[12px] text-muted">Only run if</span>
                    {step.condition ? (
                      <>
                        <Input className="h-8 w-36 font-mono text-[12px]" value={step.condition.field} placeholder="items.count" onChange={(e) => onChange({ ...step, condition: { ...step.condition!, field: e.target.value } })} />
                        <Select className="h-8 w-32" value={step.condition.op} onChange={(e) => onChange({ ...step, condition: { ...step.condition!, op: e.target.value as StepCondition["op"] } })}>
                          {COND_OPS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                        {op?.needsValue !== false ? (
                          <Input
                            className="h-8 w-28"
                            value={step.condition.value === undefined || step.condition.value === null ? "" : String(step.condition.value)}
                            placeholder="0"
                            onChange={(e) => onChange({ ...step, condition: { ...step.condition!, value: e.target.value !== "" && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value } })}
                          />
                        ) : null}
                        <button type="button" onClick={() => onChange({ ...step, condition: null })} className="rounded p-1 text-muted hover:text-ink" aria-label="Remove condition">
                          <X className="size-3.5" />
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => onChange({ ...step, condition: { field: "items.count", op: "gt", value: 0 } })} className="text-[12px] font-medium text-accent hover:underline">
                        Add a condition (otherwise always runs)
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-24 text-[12px] text-muted">On error</span>
                    <Select className="h-8 w-48" value={step.on_error} onChange={(e) => onChange({ ...step, on_error: e.target.value as DraftStep["on_error"] })}>
                      <option value="stop">Stop the run</option>
                      <option value="continue">Skip and continue</option>
                      <option value="retry">Retry, then stop</option>
                    </Select>
                    {step.on_error === "retry" ? (
                      <Select className="h-8 w-24" value={step.retries} onChange={(e) => onChange({ ...step, retries: Number(e.target.value) })}>
                        {[1, 2, 3].map((n) => (
                          <option key={n} value={n}>
                            {n}×
                          </option>
                        ))}
                      </Select>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30">
      {children}
    </button>
  );
}

function AddStepDialog({ open, onClose, agents, types, onPick }: { open: boolean; onClose: () => void; agents: ManagedAgent[]; types: AgentType[]; onPick: (s: Omit<DraftStep, "key">) => void }) {
  const [q, setQ] = useState("");
  useEffect(() => setQ(""), [open]);
  const shown = agents.filter((a) => !q || `${a.name} ${a.kind}`.toLowerCase().includes(q.toLowerCase()));
  const base = { label: "", condition: null, on_error: "stop" as const, retries: 1 };
  return (
    <Dialog open={open} onClose={onClose} title="Add a step" description="Pick one of your agents, or pause for a human." size="md">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onPick({ ...base, type: "approval", agent_id: null })}
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong p-3 text-left hover:border-warn hover:bg-warn-soft/40"
        >
          <AgentGlyph kind="approval" category="approval" />
          <span>
            <span className="block text-[13.5px] font-semibold text-ink">Approval step</span>
            <span className="block text-[12.5px] text-ink-2">Pause the run until someone approves it.</span>
          </span>
        </button>
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
          <Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your agents" />
        </label>
        <div className="max-h-[46vh] space-y-1 overflow-y-auto">
          {shown.map((a) => {
            const t = types.find((x) => x.kind === a.kind);
            return (
              <button key={a.id} type="button" onClick={() => onPick({ ...base, type: "agent", agent_id: a.id })} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
                <AgentGlyph kind={a.kind} icon={t?.icon} category={categoryOf(a.kind, types)} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{a.name}</span>
                  <span className="block truncate text-[12px] text-muted">{t?.name ?? a.kind}</span>
                </span>
                {a.status !== "active" ? <StatusPill status={a.status} /> : null}
              </button>
            );
          })}
          {!shown.length ? <p className="py-6 text-center text-[13px] text-muted">No agents match.</p> : null}
        </div>
        <p className="border-t border-line pt-3 text-[12.5px] text-muted">
          Need another agent?{" "}
          <Link href="/catalogue" className="font-medium text-accent hover:underline">
            Activate one from the catalogue
          </Link>{" "}
          or{" "}
          <Link href="/agents/new" className="font-medium text-accent hover:underline">
            build your own
          </Link>
          .
        </p>
      </div>
    </Dialog>
  );
}

export default function PipelineBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const perms = usePermissions();
  const readOnly = !perms.can("agents.manage");
  const pipeline = useQuery({ queryKey: ["pipeline", id], queryFn: () => get<Pipeline>(`/pipelines/${id}`), enabled: !isNew });
  // latest run of this workflow, so the canvas can show items flowing between steps
  const lastRun = useQuery({
    queryKey: ["runs", "latest", id],
    queryFn: () => get<{ items: PipelineRun[] }>("/runs", { pipeline_id: id, limit: 1 }),
    enabled: !isNew,
    select: (d) => d.items[0],
    refetchInterval: (q) => (q.state.data?.items[0] && ["queued", "running"].includes(q.state.data.items[0].status) ? 1500 : 8000),
  });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => get<{ items: ManagedAgent[] }>("/agents") });
  const types = useQuery({ queryKey: ["agent-types"], queryFn: () => get<{ items: AgentType[] }>("/agent-types"), staleTime: Infinity });
  const versions = useQuery({ queryKey: ["pipeline-versions", id], queryFn: () => get<{ items: PipelineVersion[] }>(`/pipelines/${id}/versions`), enabled: !isNew });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [trigger, setTrigger] = useState<{ type: "manual" | "schedule" | "webhook"; every_minutes: number | null }>({ type: "manual", every_minutes: null });
  const [requireApproval, setRequireApproval] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [adding, setAdding] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    const p = pipeline.data;
    if (!p || loadedFor === `${p.id}:${p.updated_at}`) return;
    setLoadedFor(`${p.id}:${p.updated_at}`);
    setName(p.name);
    setDescription(p.description);
    setSteps(toDraft(p));
    setTrigger({ type: p.trigger.type, every_minutes: p.trigger.every_minutes ?? null });
    setRequireApproval(p.require_approval);
    setEnabled(p.enabled);
  }, [pipeline.data, loadedFor]);

  const body = () => ({
    name: name.trim(),
    description,
    steps: steps.map((s) => ({ id: s.id, type: s.type, agent_id: s.agent_id, label: s.label || null, condition: s.condition, on_error: s.on_error, retries: s.retries })),
    trigger: { type: trigger.type, every_minutes: trigger.type === "schedule" ? (trigger.every_minutes ?? 60) : null },
    require_approval: requireApproval,
    enabled,
  });
  const dirty = useMemo(() => {
    if (isNew) return true;
    const p = pipeline.data;
    if (!p) return false;
    const orig = JSON.stringify({ n: p.name, d: p.description, s: toDraft(p).map(({ key: _k, ...r }) => r), t: [p.trigger.type, p.trigger.every_minutes ?? null], a: p.require_approval, e: p.enabled });
    const now = JSON.stringify({ n: name, d: description, s: steps.map(({ key: _k, ...r }) => r), t: [trigger.type, trigger.type === "schedule" ? trigger.every_minutes : null], a: requireApproval, e: enabled });
    return orig !== now;
  }, [isNew, pipeline.data, name, description, steps, trigger, requireApproval, enabled]);

  const save = useAction(() => (isNew ? post<Pipeline>("/pipelines", body()) : patch<Pipeline>(`/pipelines/${id}`, body())), {
    success: isNew ? "Workflow created" : "Workflow saved",
    invalidate: [["pipelines"], ["pipeline", id], ["pipeline-versions", id]],
    onSuccess: (p) => {
      if (isNew) router.replace(`/pipelines/${p.id}`);
      else setLoadedFor(null);
    },
  });
  const run = useAction(() => post<PipelineRun>(`/pipelines/${id}/run`, {}), {
    success: "Run started",
    invalidate: [["runs"], ["pipelines"]],
    onSuccess: (r) => router.push(`/runs/${r.id}`),
  });
  const remove = useAction(() => del(`/pipelines/${id}`), { success: "Workflow deleted", invalidate: [["pipelines"]], onSuccess: () => router.push("/pipelines") });

  if (!isNew && pipeline.isError) return <ErrorState error={pipeline.error} onRetry={() => pipeline.refetch()} />;
  if ((!isNew && pipeline.isPending) || agents.isPending)
    return (
      <div className="mx-auto max-w-[1100px] space-y-4">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  const agentList = agents.data?.items ?? [];
  const typeList = types.data?.items ?? [];
  const agentSteps = steps.filter((s) => s.type === "agent");
  const hasPublisher = agentSteps.some((s) => agentList.find((a) => a.id === s.agent_id)?.kind === "auto_publisher");
  const saveReason = perms.reason("agents.manage") ?? (!name.trim() ? "Name the workflow" : !agentSteps.length ? "Add at least one agent step" : !dirty ? "No changes" : null);
  const insert = (at: number, s: Omit<DraftStep, "key">) => setSteps((prev) => [...prev.slice(0, at), { ...s, key: key() }, ...prev.slice(at)]);
  const move = (i: number, d: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x);
      return next;
    });
  const webhookUrl = pipeline.data?.trigger.webhook_url;

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href="/pipelines" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Workflows
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this workflow"
            readOnly={readOnly}
            aria-label="Workflow name"
            className="w-full bg-transparent text-[24px] font-semibold tracking-tight text-ink outline-none placeholder:text-muted"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does it do? (optional)"
            readOnly={readOnly}
            aria-label="Description"
            className="mt-1 w-full bg-transparent text-[13.5px] text-ink-2 outline-none placeholder:text-muted"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button icon={<Save className="size-3.5" />} loading={save.isPending} disabledReason={saveReason} onClick={() => save.mutate(undefined)} variant={isNew ? "primary" : "secondary"}>
            {isNew ? "Create workflow" : "Save"}
          </Button>
          {!isNew ? (
            <Button variant="primary" icon={<Play className="size-3.5" />} loading={run.isPending} onClick={() => run.mutate(undefined)} disabledReason={dirty ? "Save your changes first" : !enabled ? "Workflow is turned off" : perms.reason("agents.run")}>
              Run now
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="bg-grid -mx-2 rounded-2xl px-2 py-2 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-[620px]">
            {/* Trigger */}
            <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-ink text-bg">
                  {trigger.type === "schedule" ? <Clock className="size-4" /> : trigger.type === "webhook" ? <Webhook className="size-4" /> : <Hand className="size-4" />}
                </span>
                <div className="flex-1">
                  <p className="text-[11px] font-medium text-muted">Trigger</p>
                  <p className="text-[14px] font-semibold text-ink">{trigger.type === "schedule" ? formatEvery(trigger.every_minutes ?? 60) : trigger.type === "webhook" ? "When a webhook is called" : "When you press Run"}</p>
                </div>
              </div>
              {!readOnly ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  {(["manual", "schedule", "webhook"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTrigger({ type: t, every_minutes: t === "schedule" ? (trigger.every_minutes ?? 60) : null })}
                      className={cn("h-8 rounded-lg border px-3 text-[12.5px] font-medium capitalize", trigger.type === t ? "border-ink bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong")}
                    >
                      {t}
                    </button>
                  ))}
                  {trigger.type === "schedule" ? (
                    <span className="ml-1 inline-flex items-center gap-2 text-[12.5px] text-ink-2">
                      every
                      <Input type="number" min={5} className="h-8 w-20" value={trigger.every_minutes ?? 60} onChange={(e) => setTrigger({ ...trigger, every_minutes: Number(e.target.value) || 60 })} />
                      minutes
                    </span>
                  ) : null}
                </div>
              ) : null}
              {trigger.type === "webhook" ? (
                <div className="mt-3">
                  {webhookUrl ? (
                    <CopyField value={webhookUrl} />
                  ) : (
                    <p className="text-[12px] text-muted">Save the workflow to get its webhook URL. POST to it from a form, cron job or Zapier to start a run.</p>
                  )}
                </div>
              ) : null}
            </div>

            {lastRun.data && ["queued", "running", "awaiting_approval"].includes(lastRun.data.status) ? (
              <Link href={`/runs/${lastRun.data.id}`} className="mt-3 flex items-center justify-center gap-2 rounded-full border border-accent/30 bg-accent-soft py-1.5 text-[12.5px] font-medium text-accent">
                <span className="live-dot size-1.5 rounded-full bg-accent" /> {lastRun.data.status === "awaiting_approval" ? "Waiting for your approval" : "Running now"}: open the live view
              </Link>
            ) : null}
            {steps.map((s, i) => (
              <div key={s.key}>
                <Connector
                  onAdd={() => setAdding(i)}
                  disabled={readOnly}
                  state={dirty ? "idle" : flowState(i === 0 ? undefined : lastRun.data?.steps[i - 1], lastRun.data?.steps[i])}
                  label={dirty ? null : flowLabel(lastRun.data?.steps[i])}
                />
                <StepCard
                  step={s}
                  index={i}
                  total={steps.length}
                  agent={agentList.find((a) => a.id === s.agent_id)}
                  type={typeList.find((t) => t.kind === agentList.find((a) => a.id === s.agent_id)?.kind)}
                  onChange={(n) => setSteps((prev) => prev.map((x) => (x.key === s.key ? n : x)))}
                  onMove={(d) => move(i, d)}
                  onRemove={() => setSteps((prev) => prev.filter((x) => x.key !== s.key))}
                  readOnly={readOnly}
                  live={dirty ? undefined : lastRun.data?.steps[i]}
                />
              </div>
            ))}

            <Connector onAdd={() => setAdding(steps.length)} disabled />
            <button
              type="button"
              disabled={readOnly}
              onClick={() => setAdding(steps.length)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface/70 py-4 text-[13px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <Plus className="size-4" /> Add step
            </button>
            {!steps.length ? <p className="mt-3 text-center text-[12.5px] text-muted">Chain any agents: collect → clean/sort → rewrite → save/publish.</p> : null}
          </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-4 p-5">
            <p className="text-[13px] font-semibold text-ink">Settings</p>
            <label className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-[13px] text-ink">Require approval before publishing</span>
                <span className="block text-xs text-muted">{hasPublisher ? "The run pauses before the publisher until content is approved." : "Applies when the workflow has a publisher step."}</span>
              </span>
              <Toggle checked={requireApproval} onChange={setRequireApproval} label="Require approval before publishing" disabled={readOnly} />
            </label>
            <label className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-[13px] text-ink">Enabled</span>
                <span className="block text-xs text-muted">Off = schedules and webhooks are ignored.</span>
              </span>
              <Toggle checked={enabled} onChange={setEnabled} label="Enabled" disabled={readOnly} />
            </label>
          </Card>
          {!isNew ? (
            <Card className="p-5">
              <p className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <History className="size-3.5 text-muted" /> Versions
              </p>
              {versions.isPending ? <Skeleton className="h-16" /> : null}
              <ol className="space-y-2">
                {versions.data?.items.slice(0, 6).map((v, i) => (
                  <li key={v.version} className="flex items-center gap-2 text-[12.5px]">
                    <span className={cn("rounded-md px-1.5 py-0.5 font-mono text-[11px]", i === 0 ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-2")}>v{v.version}</span>
                    <span className="flex-1 truncate text-ink-2">
                      {Array.isArray(v.steps) ? v.steps.length : 0} steps{v.created_by ? ` · ${v.created_by}` : ""}
                    </span>
                    <span className="text-[11px] text-muted">{ago(v.created_at)}</span>
                  </li>
                ))}
              </ol>
              <Link href={`/runs?pipeline_id=${id}`} className="mt-4 block text-[12.5px] font-medium text-ink-2 hover:text-accent">
                View runs of this workflow →
              </Link>
            </Card>
          ) : null}
          {!isNew ? (
            <Button variant="ghost" size="xs" icon={<Trash2 className="size-3" />} className="text-bad hover:text-bad" onClick={() => setConfirmDelete(true)} disabledReason={perms.reason("agents.manage")}>
              Delete workflow
            </Button>
          ) : null}
        </div>
      </div>

      <AddStepDialog
        open={adding !== null}
        onClose={() => setAdding(null)}
        agents={agentList}
        types={typeList}
        onPick={(s) => {
          insert(adding ?? steps.length, s);
          setAdding(null);
        }}
      />
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title="Delete this workflow?"
        description="Its agents stay. Past runs remain visible."
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
