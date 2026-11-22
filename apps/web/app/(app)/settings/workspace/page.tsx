"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Newspaper } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Banner, Button, Card, CardHeader, Dialog, Field, Input, PageHeader, QueryView, Select, Skeleton, Toggle, cn } from "@/components/ui";
import { usePermissions } from "@/components/platform/kit";
import { api, get, patch } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { WorkspaceAdminFields } from "@/lib/platform-ops-types";
import type { Module, Workspace } from "@/lib/platform-types";
import { INDUSTRIES, useSwitchWorkspace, useWorkspace } from "@/lib/workspace";

type WorkspaceFull = Workspace & Partial<WorkspaceAdminFields>;

const SWATCHES = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#8a3b12", "#111827"];

const MODULES: { value: Module; label: string; description: string }[] = [
  { value: "pipelines", label: "Workflows", description: "Agents, workflows, runs and content." },
  { value: "datasets", label: "Datasets", description: "Structured records your agents collect and your site reads." },
  { value: "assistant", label: "Assistant", description: "Real-time Q&A and comparisons over a dataset, with the embed widget." },
  { value: "newsroom", label: "Newsroom", description: "The editorial newsroom: feed, studio, review, SEO, calendar and social." },
];

const FALLBACK_ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Australia/Sydney", "UTC"];

const HEX = /^#[0-9a-f]{6}$/i;

export default function WorkspaceSettingsPage() {
  const { slug } = useWorkspace();
  const ws = useQuery({
    queryKey: ["workspace", slug],
    queryFn: () => get<WorkspaceFull>(`/workspaces/${slug}`),
    enabled: Boolean(slug),
  });

  return (
    <div className="mx-auto max-w-[880px]">
      <PageHeader title="Workspace" subtitle="Name, brand and modules of this workspace." />
      {!slug ? (
        <div className="space-y-4">
          <Skeleton className="h-[360px] rounded-xl" />
        </div>
      ) : (
        <QueryView
          query={ws}
          skeleton={
            <div className="space-y-4">
              <Skeleton className="h-[360px] rounded-xl" />
              <Skeleton className="h-[200px] rounded-xl" />
            </div>
          }
        >
          {(w) => <WorkspaceForm key={w.id} ws={w} />}
        </QueryView>
      )}
    </div>
  );
}

interface FormState {
  name: string;
  industry: string;
  brand_color: string;
  domain: string;
  website: string;
  timezone: string;
  modules: Module[];
}

const fromWorkspace = (w: WorkspaceFull): FormState => ({
  name: w.name,
  industry: w.industry || "other",
  brand_color: w.brand_color || "#0f766e",
  domain: w.domain ?? "",
  website: w.website ?? "",
  timezone: w.timezone || "UTC",
  modules: [...w.modules],
});

function WorkspaceForm({ ws }: { ws: WorkspaceFull }) {
  const perms = usePermissions();
  const reason = perms.reason("workspace.manage");
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(() => fromWorkspace(ws));
  const [hexDraft, setHexDraft] = useState(form.brand_color);
  const initial = useMemo(() => fromWorkspace(ws), [ws]);
  const dirty = JSON.stringify({ ...form, modules: [...form.modules].sort() }) !== JSON.stringify({ ...initial, modules: [...initial.modules].sort() });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const [zones, setZones] = useState<string[]>(FALLBACK_ZONES);
  useEffect(() => {
    try {
      const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
      if (all?.length) setZones(all.includes("UTC") ? all : [...all, "UTC"]);
    } catch {
      /* older browsers: keep the short list */
    }
  }, []);
  const zoneOptions = zones.includes(form.timezone) ? zones : [form.timezone, ...zones];

  const save = useAction(
    () =>
      patch<WorkspaceFull>(`/workspaces/${ws.slug}`, {
        name: form.name.trim(),
        industry: form.industry,
        brand_color: form.brand_color,
        domain: form.domain.trim() || null,
        website: form.website.trim() || null,
        timezone: form.timezone,
        modules: form.modules,
      }),
    {
      success: "Workspace saved",
      invalidate: [["me"], ["workspaces"]],
      onSuccess: (w) => {
        qc.setQueryData(["workspace", ws.slug], w);
        setForm(fromWorkspace(w));
        setHexDraft(w.brand_color);
      },
    },
  );

  const invalid = !form.name.trim() ? "Name is required" : !HEX.test(form.brand_color) ? "Brand colour must be a hex value like #2563eb" : form.modules.length === 0 ? "Turn on at least one module" : null;

  const pickColor = (c: string) => {
    set("brand_color", c);
    setHexDraft(c);
  };

  return (
    <div className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid && dirty && !reason) save.mutate(undefined);
        }}
      >
        <fieldset disabled={Boolean(reason)} className="space-y-6">
          <Card>
            <CardHeader title="General" />
            <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
              <Field label="Name">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Industry">
                <Select value={form.industry} onChange={(e) => set("industry", e.target.value)}>
                  {INDUSTRIES.map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Domain" hint="Used to build live links, e.g. example.com">
                <Input value={form.domain} onChange={(e) => set("domain", e.target.value)} placeholder="example.com" />
              </Field>
              <Field label="Website">
                <Input value={form.website} onChange={(e) => set("website", e.target.value)} placeholder="https://example.com" />
              </Field>
              <Field label="Timezone" hint="Schedules and daily quotas use this timezone." className="sm:col-span-2">
                <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                  {zoneOptions.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Brand colour" subtitle="Used for buttons, highlights and the embed widget." />
            <div className="flex flex-wrap items-center gap-6 p-4 sm:p-5">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Pick brand colour"
                    value={HEX.test(form.brand_color) ? form.brand_color : "#000000"}
                    onChange={(e) => pickColor(e.target.value)}
                    className="size-9 cursor-pointer rounded-lg border border-line-strong bg-surface p-0.5"
                  />
                  <Input
                    className="w-[120px] font-mono"
                    value={hexDraft}
                    aria-label="Hex colour"
                    onChange={(e) => {
                      const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
                      setHexDraft(v);
                      if (HEX.test(v)) set("brand_color", v.toLowerCase());
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Use ${c}`}
                      onClick={() => pickColor(c)}
                      className="flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-shadow hover:ring-2 hover:ring-line-strong"
                      style={{ background: c }}
                    >
                      {form.brand_color.toLowerCase() === c ? <Check className="size-3.5 text-white" /> : null}
                    </button>
                  ))}
                </div>
              </div>
              <BrandPreview color={HEX.test(form.brand_color) ? form.brand_color : initial.brand_color} name={form.name || ws.name} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Modules" subtitle="Turn off what this workspace doesn't use; the navigation follows." />
            <div className="divide-y divide-line">
              {MODULES.map((m) => {
                const on = form.modules.includes(m.value);
                return (
                  <div key={m.value} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-ink">{m.label}</p>
                      <p className="text-xs text-ink-2">{m.description}</p>
                    </div>
                    <Toggle
                      checked={on}
                      label={m.label}
                      disabled={Boolean(reason)}
                      title={reason ?? undefined}
                      onChange={(v) => set("modules", v ? [...form.modules, m.value] : form.modules.filter((x) => x !== m.value))}
                    />
                  </div>
                );
              })}
            </div>
          </Card>
        </fieldset>

        <div className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center justify-end gap-3">
          {dirty ? <span className="mr-auto text-[12.5px] text-muted">{invalid ?? "You have unsaved changes"}</span> : null}
          {dirty ? (
            <Button
              onClick={() => {
                setForm(initial);
                setHexDraft(initial.brand_color);
              }}
            >
              Discard
            </Button>
          ) : null}
          <Button type="submit" variant="primary" size="md" loading={save.isPending} disabledReason={reason ?? invalid ?? (dirty ? null : "No changes to save")}>
            Save changes
          </Button>
        </div>
      </form>

      {ws.modules.includes("newsroom") ? (
        <Link href="/settings" className="group flex items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-sm transition-colors hover:border-line-strong">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Newspaper className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-ink">Newsroom settings</span>
            <span className="block text-xs text-ink-2">Persona, sources, publishing schedule and SEO defaults.</span>
          </span>
          <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}

      <DangerZone ws={ws} />
    </div>
  );
}

function BrandPreview({ color, name }: { color: string; name: string }) {
  return (
    <div className="min-w-[220px] flex-1 rounded-xl border border-line bg-surface-2 p-4" aria-label="Preview">
      <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted uppercase">Preview</p>
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg text-[13px] font-semibold text-white" style={{ background: color }}>
          {(name.trim()[0] ?? "W").toUpperCase()}
        </span>
        <span className="truncate text-[13.5px] font-semibold text-ink">{name}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-white shadow-sm" style={{ background: color }}>
          Run workflow
        </span>
        <span className="inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium" style={{ color, background: `color-mix(in oklab, ${color} 12%, var(--surface))` }}>
          Active
        </span>
      </div>
    </div>
  );
}

function DangerZone({ ws }: { ws: WorkspaceFull }) {
  const perms = usePermissions();
  const { workspaces } = useWorkspace();
  const switchWs = useSwitchWorkspace();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const others = workspaces.filter((w) => w.slug !== ws.slug);

  const isOwner = perms.role ? perms.role === "owner" : perms.can("workspace.manage");
  const reason = perms.readOnly ? "Support access is read-only" : !isOwner ? "Only an owner can delete the workspace" : others.length === 0 ? "This is your only workspace" : null;

  const remove = useAction(() => api<void>(`/workspaces/${ws.slug}`, { method: "DELETE", body: { confirm: ws.slug } }), {
    success: `${ws.name} deleted`,
    onSuccess: () => {
      setOpen(false);
      if (others[0]) switchWs(others[0].slug, "/");
    },
  });

  return (
    <Card className="border-bad/30">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-ink">Delete workspace</p>
          <p className="mt-0.5 text-xs text-ink-2">Permanently deletes its agents, workflows, runs, content, datasets, connections and API keys.</p>
        </div>
        <Button variant="danger" disabledReason={reason} onClick={() => setOpen(true)}>
          Delete workspace
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirm("");
        }}
        size="sm"
        title={`Delete ${ws.name}?`}
        description="This can't be undone."
        footer={
          <>
            <Button
              onClick={() => {
                setOpen(false);
                setConfirm("");
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} disabledReason={confirm !== ws.slug ? "Type the slug to confirm" : null} onClick={() => remove.mutate(undefined)}>
              Delete forever
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Banner tone="bad" title="Everything in this workspace is deleted">
            Sites and apps using its API keys stop working immediately.
          </Banner>
          <Field label={
            <>
              Type <span className="font-mono text-ink">{ws.slug}</span> to confirm
            </>
          }>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" spellCheck={false} className={cn(confirm && confirm !== ws.slug && "border-bad")} />
          </Field>
          {others[0] ? <p className="text-xs text-muted">You&apos;ll be switched to {others[0].name}.</p> : null}
        </div>
      </Dialog>
    </Card>
  );
}
