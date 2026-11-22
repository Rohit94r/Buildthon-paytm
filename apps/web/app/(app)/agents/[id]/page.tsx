"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, ExternalLink, FlaskConical, History, Pause, Play, Power, RotateCcw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { agentStatus } from "@/components/platform/agent-utils";
import { ConfigForm, missingRequired } from "@/components/platform/config-form";
import { ImageGallery } from "@/components/platform/image-gallery";
import { AgentGlyph, CATEGORY_META, Dot, Kpi, Markdown, StatusPill, categoryOf, formatEvery, usePermissions } from "@/components/platform/kit";
import { EventTimeline, LiveBadge, useExecutionEvents } from "@/components/platform/live-events";
import { Badge, Banner, Button, Card, Dialog, ErrorState, Field, Input, Select, Skeleton, Tabs, Textarea, Toggle, cn, td, th } from "@/components/ui";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { ago, dateTime, ms, num, pct, until } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { AgentExecution, AgentOutputs, AgentVersion, ManagedAgent, MediaImage, ToolInfo } from "@/lib/platform-ops-types";
import type { AgentTestResult, AgentType, ContentItem, PipelineRun } from "@/lib/platform-types";

type Tab = "overview" | "activity" | "config" | "tools" | "history" | "outputs";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "activity", label: "Live activity" },
  { value: "config", label: "Configuration" },
  { value: "tools", label: "Tools & permissions" },
  { value: "history", label: "History" },
  { value: "outputs", label: "Outputs" },
];

const SCHEDULES = [
  { value: 0, label: "Off (run on demand or in workflows)" },
  { value: 15, label: "Every 15 minutes" },
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 720, label: "Every 12 hours" },
  { value: 1440, label: "Daily" },
  { value: 10080, label: "Weekly" },
];

/* ---------------- Overview ---------------- */
function Overview({ a, type, onTab }: { a: ManagedAgent; type?: AgentType; onTab: (t: Tab) => void }) {
  const { events } = useExecutionEvents({ agentId: a.id }, { intervalMs: 2000 });
  return (
    <div className="space-y-6">
      {a.live ? (
        <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
          <Dot tone="live" live />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">Working now</p>
            <p className="truncate text-[12.5px] text-ink-2">{a.live.message ?? "Starting…"}</p>
          </div>
          <Button size="xs" onClick={() => onTab("activity")}>
            Watch live
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Runs" value={num(a.stats.runs)} hint={a.stats.last_run_at ? `Last ${ago(a.stats.last_run_at)}` : "Never run"} />
        <Kpi label="Success rate" value={pct(a.stats.success_rate)} tone={a.stats.success_rate !== null && a.stats.success_rate < 0.8 ? "bad" : undefined} />
        <Kpi label="Avg duration" value={ms(a.stats.avg_ms)} />
        <Kpi label="Next run" value={a.schedule.next_run_at ? until(a.schedule.next_run_at).replace("in ", "") : "—"} hint={formatEvery(a.schedule.every_minutes)} />
      </div>
      {a.last_error ? (
        <Banner tone="bad" title="Last error">
          {a.last_error}
        </Banner>
      ) : null}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[13.5px] font-semibold text-ink">Recent activity</h3>
            <button type="button" onClick={() => onTab("activity")} className="text-[12.5px] text-ink-2 hover:text-accent">
              See all
            </button>
          </div>
          <EventTimeline events={events.slice(-8)} empty={<p className="py-8 text-center text-[13px] text-muted">No activity yet. Press Run now to see it work.</p>} />
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 text-[13.5px] font-semibold text-ink">About</h3>
          <p className="text-[13px] leading-relaxed text-ink-2">{a.description || type?.description}</p>
          <dl className="mt-4 space-y-2.5 text-[12.5px]">
            <Row label="Type" value={type?.name ?? a.kind} />
            <Row label="Category" value={CATEGORY_META[categoryOf(a.kind, type ? [type] : undefined)].label} />
            <Row label="Takes" value={type?.inputs ?? "—"} />
            <Row label="Produces" value={type?.outputs ?? "—"} />
            <Row label="Model" value={type?.uses_model ? a.model : "No model"} />
            <Row label="Approval" value={a.requires_approval ? "External actions wait for approval" : "Not required"} />
            <Row label="Limits" value={`${a.limits.max_items} items · ${a.limits.timeout_s}s · ${a.limits.max_retries} retries`} />
            <Row label="Created" value={dateTime(a.created_at, "d MMM yyyy")} />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-right text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

/* ---------------- Live activity ---------------- */
function LiveActivity({ a }: { a: ManagedAgent }) {
  const { events, mode, loaded } = useExecutionEvents({ agentId: a.id }, { intervalMs: 1200 });
  return (
    <Card className="p-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-semibold text-ink">Execution timeline</h3>
          <p className="text-[12.5px] text-muted">Every step, tool call and model call, as it happens. Click an event for its data.</p>
        </div>
        <LiveBadge mode={mode} />
      </div>
      {!loaded ? <Skeleton className="h-48" /> : <EventTimeline events={events} empty={<p className="py-12 text-center text-[13px] text-muted">Nothing yet. Press Run now and watch this agent work.</p>} />}
    </Card>
  );
}

/* ---------------- Configuration ---------------- */
function Configuration({ a, type }: { a: ManagedAgent; type?: AgentType }) {
  const perms = usePermissions();
  const qc = useQueryClient();
  const [name, setName] = useState(a.name);
  const [description, setDescription] = useState(a.description);
  const [config, setConfig] = useState<Record<string, unknown>>(a.config);
  const [model, setModel] = useState(a.model);
  const [limits, setLimits] = useState(a.limits);
  const [approval, setApproval] = useState(a.requires_approval);
  const [every, setEvery] = useState<number>(a.schedule.every_minutes ?? 0);
  const [note, setNote] = useState("");
  const versions = useQuery({ queryKey: ["agent-versions", a.id], queryFn: () => get<{ items: AgentVersion[] }>(`/agents/${a.id}/versions`) });
  const schema = type?.config_schema ?? [];
  const hasModelField = schema.some((f) => f.type === "model");
  const dirty = useMemo(
    () =>
      name !== a.name ||
      description !== a.description ||
      JSON.stringify(config) !== JSON.stringify(a.config) ||
      model !== a.model ||
      JSON.stringify(limits) !== JSON.stringify(a.limits) ||
      approval !== a.requires_approval ||
      (every || null) !== (a.schedule.every_minutes || null),
    [name, description, config, model, limits, approval, every, a],
  );
  const save = useAction(
    () =>
      patch<ManagedAgent>(`/agents/${a.id}`, {
        name,
        description,
        config,
        model: hasModelField && typeof config.model === "string" ? config.model : model,
        limits,
        requires_approval: approval,
        schedule: { every_minutes: every || null },
        version_note: note || undefined,
      }),
    {
      success: (r) => `Saved as version ${r.version}`,
      invalidate: [["agent", a.id], ["agent-versions", a.id], ["agents"]],
      onSuccess: () => setNote(""),
    },
  );
  const restore = useAction((v: AgentVersion) => post<ManagedAgent>(`/agents/${a.id}/versions/${v.version}/restore`), {
    success: (_r, v) => `Restored version ${v.version}`,
    invalidate: [["agent", a.id], ["agent-versions", a.id]],
    onSuccess: (r) => {
      setConfig(r.config);
      setModel(r.model);
      qc.setQueryData(["agent", a.id], r);
    },
  });
  const missing = missingRequired(schema, config);
  const reason = perms.reason("agents.manage") ?? (!dirty ? "No changes yet" : missing.length ? `Fill in: ${missing.join(", ")}` : null);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Card className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {type?.uses_model && !hasModelField ? (
              <Field label="Model">
                <Select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="fast">Fast · qwen2.5:7b</option>
                  <option value="writer">Writer · qwen2.5:14b</option>
                  {!["fast", "writer"].includes(model) ? <option value={model}>{model}</option> : null}
                </Select>
              </Field>
            ) : null}
          </div>
          <Field label="Instructions / description" hint="What this agent should do. Shown on cards and passed to the model as context.">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="border-t border-line pt-5">
            <p className="mb-4 text-[13px] font-semibold text-ink">Settings</p>
            <ConfigForm schema={schema} value={config} onChange={setConfig} disabled={!perms.can("agents.manage")} />
          </div>
        </Card>
        <Card className="space-y-5 p-6">
          <p className="text-[13px] font-semibold text-ink">Run policy</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Max items per run">
              <Input type="number" min={1} value={limits.max_items} onChange={(e) => setLimits({ ...limits, max_items: Number(e.target.value) })} />
            </Field>
            <Field label="Timeout (seconds)">
              <Input type="number" min={10} value={limits.timeout_s} onChange={(e) => setLimits({ ...limits, timeout_s: Number(e.target.value) })} />
            </Field>
            <Field label="Retries">
              <Input type="number" min={0} max={5} value={limits.max_retries} onChange={(e) => setLimits({ ...limits, max_retries: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Schedule">
            <Select value={every} onChange={(e) => setEvery(Number(e.target.value))} className="max-w-sm">
              {SCHEDULES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
              {!SCHEDULES.some((s) => s.value === every) ? <option value={every}>{formatEvery(every)}</option> : null}
            </Select>
          </Field>
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-[13px] font-medium text-ink">Require approval for external actions</span>
              <span className="block text-xs text-muted">Publishing, notifications and API calls wait until someone approves them.</span>
            </span>
            <Toggle checked={approval} onChange={setApproval} label="Require approval" />
          </label>
        </Card>
      </div>
      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="p-5">
          <p className="text-[13px] font-semibold text-ink">Save changes</p>
          <p className="mt-1 text-[12.5px] text-ink-2">Every save creates a new version you can restore later.</p>
          <Input className="mt-3" placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="primary" className="mt-3 w-full" size="md" icon={<Save className="size-3.5" />} loading={save.isPending} disabledReason={reason} onClick={() => save.mutate(undefined)}>
            Save as version {a.version + 1}
          </Button>
        </Card>
        <Card className="p-5">
          <p className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <History className="size-3.5 text-muted" /> Versions
          </p>
          {versions.isPending ? <Skeleton className="h-24" /> : null}
          <ol className="space-y-1">
            {versions.data?.items.map((v) => (
              <li key={v.version} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                <span className={cn("mt-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11px]", v.version === a.version ? "bg-accent-soft text-accent" : "bg-surface-2 text-ink-2")}>v{v.version}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{v.note ?? (v.version === a.version ? "Current" : "Saved changes")}</span>
                  <span className="block text-[11px] text-muted">
                    {ago(v.created_at)}
                    {v.created_by ? ` · ${v.created_by}` : ""}
                  </span>
                </span>
                {v.version !== a.version ? (
                  <Button size="xs" variant="ghost" icon={<RotateCcw className="size-3" />} loading={restore.isPending && restore.variables?.version === v.version} disabledReason={perms.reason("agents.manage")} onClick={() => restore.mutate(v)}>
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Tools ---------------- */
function Tools({ a }: { a: ManagedAgent }) {
  const tools = useQuery({ queryKey: ["tools"], queryFn: () => get<{ items: ToolInfo[] }>("/tools"), staleTime: Infinity });
  if (tools.isPending) return <Skeleton className="h-48 rounded-xl" />;
  const list = (tools.data?.items ?? []).filter((t) => a.tools.includes(t.key));
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-2">This agent can only use the tools below. Tools with side effects follow the approval policy{a.requires_approval ? " (approval required)" : ""}.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((t) => (
          <Card key={t.key} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[13.5px] font-semibold text-ink">{t.name}</p>
                <p className="font-mono text-[11.5px] text-muted">
                  {t.key} · v{t.version}
                </p>
              </div>
              {t.side_effects ? <Badge tone="warn">Side effects</Badge> : <Badge tone="ok">Read-only</Badge>}
            </div>
            <p className="mt-2 text-[12.5px] text-ink-2">{t.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {t.permissions.map((p) => (
                <span key={p} className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                  {p}
                </span>
              ))}
              <span className="text-[11px] text-muted">
                · {t.timeout_s}s timeout · {t.retries} retries
              </span>
            </div>
            {t.requires_connection?.length ? <p className="mt-2 text-[11.5px] text-muted">Needs a connection: {t.requires_connection.join(", ")}</p> : null}
          </Card>
        ))}
      </div>
      {!list.length ? <p className="text-[13px] text-muted">No tools listed for this agent.</p> : null}
    </div>
  );
}

/* ---------------- History ---------------- */
function HistoryTab({ a }: { a: ManagedAgent }) {
  const router = useRouter();
  const ex = useQuery({ queryKey: ["agent-executions", a.id], queryFn: () => get<{ items: AgentExecution[] }>(`/agents/${a.id}/executions`, { limit: 50 }), refetchInterval: a.live ? 2000 : 15_000 });
  if (ex.isPending) return <Skeleton className="h-48 rounded-xl" />;
  if (ex.isError) return <ErrorState error={ex.error} onRetry={() => ex.refetch()} />;
  if (!ex.data.items.length) return <p className="py-12 text-center text-[13px] text-muted">No executions yet.</p>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="border-b border-line">
          <tr>
            <th className={th}>Status</th>
            <th className={th}>Workflow</th>
            <th className={th}>Trigger</th>
            <th className={cn(th, "text-right")}>Items</th>
            <th className={cn(th, "text-right")}>Duration</th>
            <th className={th}>Started</th>
          </tr>
        </thead>
        <tbody>
          {ex.data.items.map((e) => (
            <tr key={`${e.run_id}-${e.step_id}`} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2" onClick={() => router.push(`/runs/${e.run_id}`)}>
              <td className={td}>
                <StatusPill status={e.status} />
              </td>
              <td className={cn(td, "max-w-[260px] truncate text-ink")}>{e.pipeline_name ?? <span className="text-muted">Single run</span>}</td>
              <td className={cn(td, "text-ink-2 capitalize")}>{e.trigger}</td>
              <td className={cn(td, "text-right text-ink-2 tabular")}>
                {e.items_in} → {e.items_out}
              </td>
              <td className={cn(td, "text-right text-ink-2 tabular")}>{ms(e.duration_ms)}</td>
              <td className={cn(td, "text-muted")} title={dateTime(e.started_at)}>
                {ago(e.started_at, "Queued")}
                {e.error ? <span className="block max-w-[260px] truncate text-xs text-bad">{e.error}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ---------------- Outputs ---------------- */
function OutputsTab({ a }: { a: ManagedAgent }) {
  const out = useQuery({ queryKey: ["agent-outputs", a.id], queryFn: () => get<AgentOutputs>(`/agents/${a.id}/outputs`) });
  const content = useQuery({ queryKey: ["content", "all-for-outputs"], queryFn: () => get<{ items: ContentItem[] }>("/content", { limit: 100 }), enabled: Boolean(out.data?.content_ids.length) });
  if (out.isPending) return <Skeleton className="h-48 rounded-xl" />;
  if (out.isError) return <ErrorState error={out.error} onRetry={() => out.refetch()} />;
  const o = out.data;
  const items = o.items ?? [];
  const keys = [...new Set(items.flatMap((i) => Object.keys(i.data ?? {})))].filter((k) => k !== "images").slice(0, 5);
  const images = items.flatMap((i) => (Array.isArray(i.data?.images) ? (i.data.images as MediaImage[]) : []));
  return (
    <div className="space-y-6">
      {images.length ? (
        <Card className="p-5">
          <p className="text-[13.5px] font-semibold text-ink">Pictures found</p>
          <p className="mb-4 text-[12px] text-muted">{images.length} images · green badges are free to reuse with the credit shown</p>
          <ImageGallery images={images} />
        </Card>
      ) : null}
      {o.report ? (
        <Card className="p-6">
          <Markdown text={o.report} />
        </Card>
      ) : null}
      {o.dataset_changes ? (
        <Banner tone="ok" title="Dataset changes" action={<Link href={`/datasets/${o.dataset_changes.dataset_id}`} className="text-xs font-medium underline">Open dataset</Link>}>
          {o.dataset_changes.created} created · {o.dataset_changes.updated} updated in the last run
        </Banner>
      ) : null}
      {o.content_ids.length ? (
        <Card className="p-5">
          <p className="mb-3 text-[13.5px] font-semibold text-ink">Content it helped create</p>
          <ul className="-mx-2">
            {o.content_ids.map((id) => {
              const c = content.data?.items.find((x) => x.id === id);
              return (
                <li key={id}>
                  <Link href={`/content/${id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                    {c ? <StatusPill status={c.status} /> : null}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{c?.title ?? id}</span>
                    <ExternalLink className="size-3.5 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      <Card className="overflow-x-auto">
        <div className="px-5 pt-4 pb-2">
          <p className="text-[13.5px] font-semibold text-ink">Latest output items</p>
          <p className="text-[12px] text-muted">{items.length} items from the last successful execution</p>
        </div>
        {items.length ? (
          <table className="w-full text-[13px]">
            <thead className="border-y border-line">
              <tr>
                <th className={th}>Title</th>
                {keys.map((k) => (
                  <th key={k} className={th}>
                    {k.replace(/_/g, " ")}
                  </th>
                ))}
                <th className={th}>Flags</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-line last:border-0">
                  <td className={cn(td, "max-w-[320px]")}>
                    <span className="line-clamp-2 text-ink">{it.title}</span>
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noreferrer" className="text-[11.5px] text-muted hover:text-accent">
                        {it.source_name ?? it.url}
                      </a>
                    ) : null}
                  </td>
                  {keys.map((k) => (
                    <td key={k} className={cn(td, "max-w-[180px] truncate text-ink-2")}>
                      {fmt(it.data?.[k])}
                    </td>
                  ))}
                  <td className={td}>
                    {it.flags?.map((f) => (
                      <Badge key={f} tone="warn" className="mr-1">
                        {f}
                      </Badge>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-5 pb-6 text-[13px] text-muted">No output yet.</p>
        )}
      </Card>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* ---------------- Test drawer ---------------- */
function TestDialog({ a, open, onClose }: { a: ManagedAgent; open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const test = useAction(() => post<AgentTestResult>(`/agents/${a.id}/test`, { input: { text: text || undefined, url: url || undefined } }), { silent: true });
  const r = test.data;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Test ${a.name}`}
      description="Runs the agent once on this input. Nothing is saved or published."
      footer={
        <Button variant="primary" icon={<FlaskConical className="size-3.5" />} loading={test.isPending} onClick={() => test.mutate(undefined)}>
          Run test
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="URL" hint="Optional: a page or feed to work on">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Text" hint="Optional: paste an article, a question or some items">
          <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {test.isError ? <Banner tone="bad" title="Test failed">{test.error instanceof ApiError ? test.error.message : "Something went wrong"}</Banner> : null}
        {r ? (
          <div className="space-y-3 border-t border-line pt-4">
            <div className="flex items-center gap-2 text-[12.5px]">
              <StatusPill status={r.ok ? "succeeded" : "failed"} />
              <span className="text-muted">
                {ms(r.duration_ms)} · {r.items.length} items{r.model ? ` · ${r.model}` : ""}
              </span>
            </div>
            {r.error ? <p className="text-[13px] text-bad">{r.error}</p> : null}
            <div className="space-y-2">
              {r.items.slice(0, 5).map((it) => (
                <div key={it.id} className="rounded-lg border border-line p-3">
                  <p className="text-[13px] font-medium text-ink">{it.title}</p>
                  {it.summary || it.text ? <p className="mt-1 line-clamp-3 text-[12.5px] text-ink-2">{it.summary ?? it.text}</p> : null}
                  {Object.keys(it.data ?? {}).length ? <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[11px] text-ink-2">{JSON.stringify(it.data, null, 2)}</pre> : null}
                </div>
              ))}
            </div>
            {r.logs.length ? (
              <div className="rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-ink-2">
                {r.logs.map((l, i) => (
                  <p key={i} className={l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : ""}>
                    {l.message}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------------- Page ---------------- */
function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const perms = usePermissions();
  const [tab, setTab] = useState<Tab>("overview");
  const [testing, setTesting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const agent = useQuery({
    queryKey: ["agent", id],
    queryFn: () => get<ManagedAgent>(`/agents/${id}`),
    refetchInterval: (q) => (q.state.data?.live ? 1500 : 6000),
  });
  const types = useQuery({ queryKey: ["agent-types"], queryFn: () => get<{ items: AgentType[] }>("/agent-types"), staleTime: Infinity });
  useEffect(() => {
    const t = params.get("tab") as Tab | null;
    if (t && TABS.some((x) => x.value === t)) setTab(t);
  }, [params]);
  const inv = [["agent", id], ["agents"], ["agents-overview"], ["agent-executions", id]];
  const run = useAction(() => post<PipelineRun>(`/agents/${id}/run`, {}), { success: "Run started", invalidate: inv, onSuccess: () => setTab("activity") });
  const lifecycle = useAction((action: "pause" | "resume" | "disable") => post<ManagedAgent>(`/agents/${id}/${action}`), {
    success: (r) => `${r.name} is ${r.status}`,
    invalidate: inv,
  });
  const remove = useAction(() => del(`/agents/${id}`), { success: "Agent deleted", invalidate: [["agents"], ["agents-overview"], ["catalog"]], onSuccess: () => router.push("/agents") });

  if (agent.isError) return <ErrorState error={agent.error} onRetry={() => agent.refetch()} />;
  if (agent.isPending)
    return (
      <div className="mx-auto max-w-[1200px] space-y-6">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  const a = agent.data;
  const type = types.data?.items.find((t) => t.kind === a.kind);
  const st = agentStatus(a);
  return (
    <div className="mx-auto max-w-[1200px]">
      <Link href="/agents" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> My agents
      </Link>
      {params.get("welcome") ? (
        <Banner tone="ok" title={`${a.name} is active`} className="mb-5">
          Review its settings under Configuration, press Run now to see it work, or add it to a workflow.
        </Banner>
      ) : null}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <AgentGlyph kind={a.kind} icon={type?.icon} category={categoryOf(a.kind, types.data?.items)} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-[24px] leading-tight font-semibold tracking-tight text-ink">{a.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <Dot tone={st.tone} live={st.tone === "live"} /> {st.label}
              </span>
              <span className="text-muted">·</span>
              <span>v{a.version}</span>
              <Badge>{a.source === "platform" ? "From the catalogue" : "Custom"}</Badge>
              {a.schedule.every_minutes ? (
                <Badge tone="info">
                  <CalendarClock className="size-3" /> {formatEvery(a.schedule.every_minutes)}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<FlaskConical className="size-3.5" />} onClick={() => setTesting(true)} disabledReason={perms.reason("agents.run")}>
            Test
          </Button>
          <Button icon={<CalendarClock className="size-3.5" />} onClick={() => setScheduling(true)} disabledReason={perms.reason("agents.manage")}>
            Schedule
          </Button>
          {a.status === "paused" || a.status === "disabled" ? (
            <Button icon={<Play className="size-3.5" />} loading={lifecycle.isPending} onClick={() => lifecycle.mutate("resume")} disabledReason={perms.reason("agents.run")}>
              {a.status === "disabled" ? "Enable" : "Resume"}
            </Button>
          ) : (
            <Button icon={<Pause className="size-3.5" />} loading={lifecycle.isPending && lifecycle.variables === "pause"} onClick={() => lifecycle.mutate("pause")} disabledReason={perms.reason("agents.run")}>
              Pause
            </Button>
          )}
          <Button variant="primary" icon={<Play className="size-3.5" />} loading={run.isPending} onClick={() => run.mutate(undefined)} disabledReason={a.status !== "active" ? `Agent is ${a.status}. Resume it to run.` : a.live ? "Already running" : perms.reason("agents.run")}>
            Run now
          </Button>
        </div>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-6" />
      {tab === "overview" ? <Overview a={a} type={type} onTab={setTab} /> : null}
      {tab === "activity" ? <LiveActivity a={a} /> : null}
      {tab === "config" ? <Configuration key={`${a.id}-${a.version}`} a={a} type={type} /> : null}
      {tab === "tools" ? <Tools a={a} /> : null}
      {tab === "history" ? <HistoryTab a={a} /> : null}
      {tab === "outputs" ? <OutputsTab a={a} /> : null}

      <div className="mt-12 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
        {a.status !== "disabled" ? (
          <Button variant="ghost" size="xs" icon={<Power className="size-3" />} onClick={() => lifecycle.mutate("disable")} disabledReason={perms.reason("agents.manage")}>
            Disable agent
          </Button>
        ) : null}
        <Button variant="ghost" size="xs" icon={<Trash2 className="size-3" />} className="text-bad hover:text-bad" onClick={() => setConfirmDelete(true)} disabledReason={perms.reason("agents.manage")}>
          Delete agent
        </Button>
      </div>

      <TestDialog a={a} open={testing} onClose={() => setTesting(false)} />
      <ScheduleDialog a={a} open={scheduling} onClose={() => setScheduling(false)} />
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title={`Delete ${a.name}?`}
        description="Its history stays in past runs. Workflows that use it must be changed first."
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

function ScheduleDialog({ a, open, onClose }: { a: ManagedAgent; open: boolean; onClose: () => void }) {
  const [every, setEvery] = useState<number>(a.schedule.every_minutes ?? 0);
  useEffect(() => setEvery(a.schedule.every_minutes ?? 0), [open, a.schedule.every_minutes]);
  const save = useAction(() => patch<ManagedAgent>(`/agents/${a.id}`, { schedule: { every_minutes: every || null } }), {
    success: every ? `Runs ${formatEvery(every).toLowerCase()}` : "Schedule turned off",
    invalidate: [["agent", a.id], ["agents"], ["agents-overview"]],
    onSuccess: onClose,
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Schedule"
      description="Scheduled agents run on their own. Paused agents are skipped."
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Save schedule
        </Button>
      }
    >
      <div className="space-y-1.5">
        {SCHEDULES.map((s) => (
          <label key={s.value} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px]", every === s.value ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:border-line-strong")}>
            <input type="radio" name="every" checked={every === s.value} onChange={() => setEvery(s.value)} className="accent-[var(--accent)]" />
            {s.label}
          </label>
        ))}
      </div>
    </Dialog>
  );
}

export default function AgentDetailPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-[1200px] rounded-xl" />}>
      <AgentPage />
    </Suspense>
  );
}
