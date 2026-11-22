"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Pencil, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { POPULAR_KEYS, popular } from "@/components/platform/catalog-utils";
import { AgentGlyph, Empty, StatusPill } from "@/components/platform/kit";
import { Badge, Button, Dialog, ErrorState, Field, Input, PageHeader, Select, Skeleton, cn } from "@/components/ui";
import { api, errorMessage, get, patch, post } from "@/lib/api";
import { ago, num } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { CatalogAgent, Plan, PlanKey, WorkspaceAdminFields } from "@/lib/platform-ops-types";
import type { Workspace } from "@/lib/platform-types";
import { INDUSTRIES, industryLabel, useSwitchWorkspace, useWorkspace } from "@/lib/workspace";

type W = Workspace & Partial<WorkspaceAdminFields>;
const SWATCHES = ["#0f766e", "#2563eb", "#c2410c", "#be123c", "#4d7c0f", "#7c3aed", "#0e7490", "#334155"];

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SWATCHES.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} className={cn("flex size-8 items-center justify-center rounded-lg ring-offset-2 ring-offset-surface", value.toLowerCase() === c && "ring-2 ring-ink")} style={{ background: c }} aria-label={`Use ${c}`}>
          {value.toLowerCase() === c ? <Check className="size-3.5 text-white" /> : null}
        </button>
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-8 cursor-pointer rounded-lg border border-line bg-surface" aria-label="Custom colour" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-24 font-mono text-[12px]" aria-label="Hex colour" />
    </div>
  );
}

/* ---------------- New client wizard ---------------- */
function NewClientWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const switchTo = useSwitchWorkspace();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("news_media");
  const [picked, setPicked] = useState<string[]>([]);
  const [color, setColor] = useState(SWATCHES[1]);
  const [domain, setDomain] = useState("");
  const [created, setCreated] = useState<{ ws: Workspace; activated: number; failed: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => get<{ items: CatalogAgent[] }>("/catalog"), enabled: open });
  const items = catalog.data?.items ?? [];
  useEffect(() => {
    if (open) {
      setStep(0);
      setName("");
      setIndustry("news_media");
      setColor(SWATCHES[1]);
      setDomain("");
      setCreated(null);
      setBusy(null);
    }
  }, [open]);
  useEffect(() => {
    if (open && catalog.data) setPicked(popular(catalog.data.items).filter((a) => a.pricing.tier === "free").map((a) => a.key));
  }, [open, catalog.data]);
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const create = async () => {
    setBusy("Creating the workspace…");
    try {
      const ws = await post<Workspace>("/workspaces", { name: name.trim(), industry, brand_color: color, domain: domain || null });
      let activated = 0;
      const failed: string[] = [];
      for (const key of picked) {
        setBusy(`Adding agents ${activated + failed.length + 1}/${picked.length}…`);
        try {
          await api(`/catalog/${key}/activate`, { method: "POST", body: {}, workspace: ws.slug });
          activated += 1;
        } catch {
          failed.push(items.find((i) => i.key === key)?.name ?? key);
        }
      }
      setCreated({ ws, activated, failed });
    } catch (e) {
      toast.error("Couldn't create the client", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const steps = ["Name", "Industry", "Starter agents", "Brand"];
  const canNext = step === 0 ? name.trim().length > 1 : true;
  const free = items.filter((a) => a.pricing.tier === "free");
  const shownStarters = [...popular(free), ...free.filter((a) => !POPULAR_KEYS.includes(a.key))];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={created ? "Client ready" : "New client"}
      description={created ? undefined : `Step ${step + 1} of ${steps.length} · ${steps[step]}`}
      footer={
        created ? (
          <>
            <Button onClick={onClose}>Stay here</Button>
            <Button variant="primary" onClick={() => switchTo(created.ws.slug)}>
              Open {created.ws.name} <ArrowRight className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            {step > 0 ? (
              <Button variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={() => setStep(step - 1)} className="mr-auto" disabled={Boolean(busy)}>
                Back
              </Button>
            ) : null}
            {step < steps.length - 1 ? (
              <Button variant="primary" disabledReason={canNext ? null : "Enter a name"} onClick={() => setStep(step + 1)}>
                Continue <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <Button variant="primary" loading={Boolean(busy)} onClick={create}>
                {busy ?? "Create client"}
              </Button>
            )}
          </>
        )
      }
    >
      {created ? (
        <div className="py-4 text-center">
          <span className="animate-pop mx-auto flex size-12 items-center justify-center rounded-2xl text-[18px] font-semibold text-white" style={{ background: created.ws.brand_color }}>
            {created.ws.name.slice(0, 1)}
          </span>
          <p className="mt-3 text-[15px] font-semibold text-ink">{created.ws.name}</p>
          <p className="mt-1 text-[13px] text-ink-2">{created.activated ? `${created.activated} starter agent${created.activated === 1 ? "" : "s"} ready to go.` : "An empty workspace: add agents from the catalogue."}</p>
          {created.failed.length ? <p className="mt-1 text-[12px] text-warn">Couldn&apos;t add: {created.failed.join(", ")}</p> : null}
        </div>
      ) : (
        <div>
          <div className="mb-6 flex gap-1.5">
            {steps.map((s, i) => (
              <span key={s} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-accent" : "bg-surface-3")} />
            ))}
          </div>
          {step === 0 ? (
            <Field label="Client name" hint="You can change it later.">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MarketPulse News" className="h-10" onKeyDown={(e) => e.key === "Enter" && canNext && setStep(1)} />
            </Field>
          ) : null}
          {step === 1 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {INDUSTRIES.map((i) => (
                <button key={i.value} type="button" onClick={() => setIndustry(i.value)} className={cn("rounded-xl border px-4 py-3 text-left text-[13.5px]", industry === i.value ? "border-accent bg-accent-soft font-medium text-ink" : "border-line text-ink-2 hover:border-line-strong")}>
                  {i.label}
                </button>
              ))}
            </div>
          ) : null}
          {step === 2 ? (
            catalog.isPending ? (
              <Skeleton className="h-48" />
            ) : (
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[13px] text-ink-2">Pick a few agents to start with. Popular ones are already ticked; you can add more any time.</p>
                  <button type="button" onClick={() => setPicked([])} className="shrink-0 text-[12px] text-muted hover:text-ink">
                    Start empty
                  </button>
                </div>
                <div className="grid max-h-[46vh] gap-2 overflow-y-auto sm:grid-cols-2">
                  {shownStarters.map((a) => {
                    const on = picked.includes(a.key);
                    return (
                      <button key={a.key} type="button" onClick={() => toggle(a.key)} aria-pressed={on} className={cn("flex items-start gap-3 rounded-xl border p-3 text-left", on ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong")}>
                        <AgentGlyph kind={a.kind} icon={a.icon} category={a.kind_category} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                            {a.name}
                            {POPULAR_KEYS.includes(a.key) ? <span className="rounded-full bg-warn-soft px-1.5 text-[10.5px] font-medium text-warn">Popular</span> : null}
                          </span>
                          <span className="line-clamp-2 block text-[12px] text-ink-2">{a.everyday_use || a.tagline}</span>
                        </span>
                        <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent-solid text-white" : "border-line-strong")}>{on ? <Check className="size-3" /> : null}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-[12px] text-muted">{picked.length ? `${picked.length} selected` : "Starting empty"} · free agents here; premium agents follow the client&apos;s plan.</p>
              </div>
            )
          ) : null}
          {step === 3 ? (
            <div className="space-y-5">
              <Field label="Brand colour" hint="Used as the accent colour in this client's workspace.">
                <ColorPicker value={color} onChange={setColor} />
              </Field>
              <Field label="Website domain" hint="Optional">
                <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
              </Field>
              <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-4">
                <span className="flex size-9 items-center justify-center rounded-lg text-[14px] font-semibold text-white" style={{ background: /^#[0-9a-f]{6}$/i.test(color) ? color : "#334155" }}>
                  {name.slice(0, 1).toUpperCase() || "?"}
                </span>
                <span>
                  <span className="block text-[13.5px] font-semibold text-ink">{name || "New client"}</span>
                  <span className="block text-[12px] text-muted">
                    {industryLabel(industry)} · {picked.length} starter agent{picked.length === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

/* ---------------- Edit client ---------------- */
function EditClient({ w, onClose }: { w: W | null; onClose: () => void }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => get<{ items: Plan[] }>("/plans"), staleTime: Infinity });
  const [form, setForm] = useState({ name: "", industry: "", brand_color: "", domain: "", plan: "free" as PlanKey, status: "active" as "active" | "suspended" });
  useEffect(() => {
    if (w) setForm({ name: w.name, industry: w.industry, brand_color: w.brand_color, domain: w.domain ?? "", plan: w.plan ?? "free", status: w.status ?? "active" });
  }, [w]);
  const save = useAction(
    async () => {
      if (!w) return null;
      await patch<Workspace>(`/workspaces/${w.slug}`, { name: form.name, industry: form.industry, brand_color: form.brand_color, domain: form.domain || null });
      if (form.plan !== w.plan || form.status !== w.status) await patch<Workspace>(`/workspaces/${w.slug}`, { plan: form.plan, status: form.status });
      return null;
    },
    {
      success: "Client updated",
      invalidate: [["workspaces"], ["platform-overview"]],
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ["me"] });
        onClose();
      },
    },
  );
  return (
    <Dialog
      open={!!w}
      onClose={onClose}
      title={`Edit ${w?.name ?? ""}`}
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Industry">
            <Select value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
              {INDUSTRIES.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Domain">
          <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
        </Field>
        <Field label="Brand colour">
          <ColorPicker value={form.brand_color} onChange={(v) => setForm({ ...form, brand_color: v })} />
        </Field>
        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <Field label="Plan" hint="Payments aren't connected; this sets the limits.">
            <Select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as PlanKey })}>
              {(plans.data?.items ?? []).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" hint="Suspended clients can't run anything.">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "suspended" })}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function Clients() {
  const params = useSearchParams();
  const router = useRouter();
  const ws = useWorkspace();
  const switchTo = useSwitchWorkspace();
  const [wizard, setWizard] = useState(false);
  const [editing, setEditing] = useState<W | null>(null);
  const q = useQuery({ queryKey: ["workspaces"], queryFn: () => get<{ items: W[] }>("/workspaces") });
  useEffect(() => {
    if (params.get("new")) {
      setWizard(true);
      router.replace("/clients");
    }
  }, [params, router]);
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Clients"
        subtitle="Each client gets its own workspace: agents, workflows, data, connections and brand."
        actions={
          <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setWizard(true)} disabledReason={ws.isPlatformAdmin ? null : "Only platform admins can add clients"}>
            New client
          </Button>
        }
      />
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : null}
      {q.data && !q.data.items.length ? <Empty title="No clients yet" action={<Button variant="primary" onClick={() => setWizard(true)}>New client</Button>} /> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data?.items.map((w) => (
          <div key={w.slug} className={cn("flex flex-col rounded-xl border bg-surface p-5 shadow-sm", w.slug === ws.slug ? "border-accent/40" : "border-line")}>
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold text-white" style={{ background: w.brand_color }}>
                {w.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-semibold text-ink">{w.name}</p>
                <p className="truncate text-[12px] text-muted">
                  {industryLabel(w.industry)}
                  {w.domain ? ` · ${w.domain}` : ""}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {w.plan ? <Badge tone={w.plan === "free" ? "neutral" : "accent"}>{w.plan}</Badge> : null}
                {w.status === "suspended" ? <StatusPill status="suspended" /> : null}
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-surface-2/70 px-3 py-2.5 text-center">
              {[
                ["Agents", w.stats.agents],
                ["Runs 24h", w.stats.runs_24h],
                ["Content 7d", w.stats.content_7d],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <dt className="text-[11px] text-muted">{l}</dt>
                  <dd className="text-[15px] font-semibold text-ink tabular">{num(v as number)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap gap-1">
              {w.modules.map((m) => (
                <span key={m} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2 capitalize">
                  {m}
                </span>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <span className="text-[11.5px] text-muted">Created {ago(w.created_at)}</span>
              <div className="flex gap-1.5">
                <Button size="xs" variant="ghost" icon={<Pencil className="size-3" />} onClick={() => setEditing(w)} disabledReason={ws.isPlatformAdmin ? null : "Platform admins only"}>
                  Edit
                </Button>
                <Button size="xs" variant={w.slug === ws.slug ? "subtle" : "secondary"} onClick={() => (w.slug === ws.slug ? router.push("/") : switchTo(w.slug))}>
                  {w.slug === ws.slug ? "Current" : "Open"}
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <NewClientWizard open={wizard} onClose={() => setWizard(false)} />
      <EditClient w={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Suspense fallback={null}>
      <Clients />
    </Suspense>
  );
}
