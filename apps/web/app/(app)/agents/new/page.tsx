"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ConfigForm, defaultsFor, missingRequired } from "@/components/platform/config-form";
import { AgentGlyph, CATEGORY_META, usePermissions } from "@/components/platform/kit";
import { Button, Card, ErrorState, Field, Input, PageHeader, Skeleton, Textarea, cn } from "@/components/ui";
import { get, post } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { Agent, AgentCategory, AgentType } from "@/lib/platform-types";

const ORDER: AgentCategory[] = ["collect", "create", "quality", "data", "deliver", "assist"];

function Builder() {
  const router = useRouter();
  const params = useSearchParams();
  const perms = usePermissions();
  const types = useQuery({ queryKey: ["agent-types"], queryFn: () => get<{ items: AgentType[] }>("/agent-types"), staleTime: Infinity });
  const [type, setType] = useState<AgentType | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});

  const choose = (t: AgentType) => {
    setType(t);
    setName(t.name);
    setDescription(t.description);
    setConfig(defaultsFor(t.config_schema));
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const k = params.get("kind");
    const t = types.data?.items.find((x) => x.kind === k);
    if (t && !type) choose(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.data, params]);

  const create = useAction(() => post<Agent>("/agents", { name: name.trim(), kind: type?.kind, description, config, model: typeof config.model === "string" ? config.model : undefined }), {
    success: (a) => `${a.name} created`,
    invalidate: [["agents"], ["agents-overview"]],
    onSuccess: (a) => router.push(`/agents/${a.id}`),
  });

  if (types.isError) return <ErrorState error={types.error} onRetry={() => types.refetch()} />;
  if (types.isPending) return <Skeleton className="h-96 rounded-xl" />;

  if (!type) {
    const grouped = ORDER.map((c) => ({ c, items: types.data.items.filter((t) => t.category === c) })).filter((g) => g.items.length);
    return (
      <div className="space-y-8">
        {grouped.map(({ c, items }) => (
          <section key={c}>
            <div className="mb-3 flex items-baseline gap-2">
              <span className="size-2 rounded-full" style={{ background: CATEGORY_META[c].color }} />
              <h2 className="text-[14px] font-semibold text-ink">{CATEGORY_META[c].label}</h2>
              <p className="text-[12.5px] text-muted">{CATEGORY_META[c].hint}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((t) => (
                <button key={t.kind} type="button" onClick={() => choose(t)} className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-md">
                  <AgentGlyph kind={t.kind} icon={t.icon} category={t.category} />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-ink">{t.name}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-ink-2">{t.description}</span>
                    <span className="mt-2 block text-[11.5px] text-muted">
                      {t.inputs} → {t.outputs}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const missing = missingRequired(type.config_schema, config);
  const reason = perms.reason("agents.manage") ?? (!name.trim() ? "Give the agent a name" : missing.length ? `Fill in: ${missing.join(", ")}` : null);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <AgentGlyph kind={type.kind} icon={type.icon} category={type.category} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-ink">{type.name}</p>
            <p className="text-[12.5px] text-ink-2">{type.description}</p>
          </div>
          <Button size="xs" variant="ghost" icon={<ArrowLeft className="size-3" />} onClick={() => setType(null)}>
            Change type
          </Button>
        </div>
        <div className="space-y-5 border-t border-line pt-6">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hackathon Sorter" />
          </Field>
          <Field label="What it does" hint="Shown on cards and in workflows.">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="border-t border-line pt-5">
            <p className="mb-4 text-[13px] font-semibold text-ink">Settings</p>
            <ConfigForm schema={type.config_schema} value={config} onChange={setConfig} />
          </div>
        </div>
      </Card>
      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="p-5">
          <p className="text-[13px] font-semibold text-ink">Ready?</p>
          <p className="mt-1 text-[12.5px] text-ink-2">You can test it on the next screen, then add it to any workflow.</p>
          <Button variant="primary" size="lg" className="mt-4 w-full" loading={create.isPending} disabledReason={reason} onClick={() => create.mutate(undefined)}>
            Create agent <ArrowRight className="size-4" />
          </Button>
        </Card>
        <div className="flex gap-2.5 rounded-xl border border-line bg-surface-2/60 p-4 text-[12.5px] text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-muted" />
          <p>
            Chain any agents: <strong className="font-medium text-ink">collect → clean/sort → rewrite → save/publish</strong>. Every agent works on the items the previous step hands over.
          </p>
        </div>
        <dl className={cn("space-y-2 rounded-xl border border-line bg-surface p-4 text-[12.5px]")}>
          <div>
            <dt className="text-muted">Takes</dt>
            <dd className="text-ink">{type.inputs}</dd>
          </div>
          <div>
            <dt className="text-muted">Produces</dt>
            <dd className="text-ink">{type.outputs}</dd>
          </div>
          {type.uses_model ? (
            <div>
              <dt className="text-muted">Model</dt>
              <dd className="text-ink">Uses the {type.default_model ?? "fast"} model by default</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}

export default function NewAgentPage() {
  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href="/agents" className="mb-3 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> My agents
      </Link>
      <PageHeader title="Build an agent" subtitle="Start from any agent type. Settings are generated from the type, so every agent is configurable the same way." />
      <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
        <Builder />
      </Suspense>
    </div>
  );
}
