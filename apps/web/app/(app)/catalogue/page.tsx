"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Check, Flame, Lock, Plus, Wrench, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CAT_LABEL, CAT_ORDER, popular } from "@/components/platform/catalog-utils";
import { AgentGlyph, CATEGORY_META, Empty, FilterChips, SearchInput, usePermissions } from "@/components/platform/kit";
import { Badge, Button, Drawer, PageHeader, Skeleton, ErrorState, cn } from "@/components/ui";
import { get, post } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { CatalogAgent, CatalogCategory, ManagedAgent } from "@/lib/platform-ops-types";



function TierBadge({ tier }: { tier: CatalogAgent["pricing"]["tier"] }) {
  if (tier === "free") return <Badge tone="neutral">Free</Badge>;
  if (tier === "pro") return <Badge tone="accent">Pro</Badge>;
  return <Badge tone="info">Enterprise</Badge>;
}

function upgradeReason(a: CatalogAgent) {
  return a.entitled ? null : a.pricing.tier === "pro" ? "Upgrade to Pro to activate" : "Available on Enterprise";
}

export default function CataloguePage() {
  const router = useRouter();
  const perms = usePermissions();
  const [cat, setCat] = useState<"all" | CatalogCategory>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<CatalogAgent | null>(null);
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => get<{ items: CatalogAgent[] }>("/catalog") });
  const activate = useAction((a: CatalogAgent) => post<ManagedAgent>(`/catalog/${a.key}/activate`, {}), {
    success: (r) => `${r.name} activated`,
    invalidate: [["catalog"], ["agents"], ["agents-overview"]],
    onSuccess: (r) => router.push(`/agents/${r.id}?welcome=1`),
  });

  const items = catalog.data?.items ?? [];
  const cats = useMemo(() => {
    const present = CAT_ORDER.filter((c) => items.some((i) => i.category === c));
    return [{ value: "all" as const, label: "All", count: items.length }, ...present.map((c) => ({ value: c, label: CAT_LABEL[c] ?? c, count: items.filter((i) => i.category === c).length }))];
  }, [items]);
  const shown = items.filter((i) => (cat === "all" || i.category === cat) && (!q || `${i.name} ${i.tagline} ${i.capabilities.join(" ")}`.toLowerCase().includes(q.toLowerCase())));

  const activateBtn = (a: CatalogAgent, size: "sm" | "md" = "sm") => {
    const reason = upgradeReason(a) ?? perms.reason("agents.manage");
    return (
      <Button
        variant={size === "md" && !a.activated_agent_ids.length ? "primary" : "secondary"}
        size={size}
        icon={reason && !a.entitled ? <Lock className="size-3.5" /> : a.activated_agent_ids.length ? <Plus className="size-3.5" /> : <Zap className="size-3.5" />}
        loading={activate.isPending && activate.variables?.key === a.key}
        disabledReason={reason}
        onClick={(e) => {
          e.stopPropagation();
          activate.mutate(a);
        }}
      >
        {!a.entitled ? (a.pricing.tier === "pro" ? "Upgrade to Pro" : "Enterprise") : a.activated_agent_ids.length ? "Add another" : "Activate"}
      </Button>
    );
  };

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Agent catalogue"
        subtitle="Ready-made agents you can activate in one click, configure, and chain into workflows."
        actions={
          <Link href="/agents/new" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
            <Wrench className="size-3.5" /> Build a custom agent
          </Link>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <FilterChips value={cat} onChange={setCat} options={cats} />
        <SearchInput value={q} onChange={setQ} placeholder="Search agents" className="ml-auto w-full sm:w-64" />
      </div>

      {catalog.isError ? <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} /> : null}
      {catalog.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[188px] rounded-xl" />
          ))}
        </div>
      ) : null}
      {catalog.data && !shown.length ? <Empty title="No agents match" body="Try another category or search term." /> : null}

      {cat === "all" && !q && popular(items).length ? (
        <section className="mb-10">
          <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Flame className="size-4 text-warn" /> Popular
          </h2>
          <p className="mb-4 text-[13px] text-muted">What most people start with.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {popular(items).map((a) => (
              <div
                key={a.key}
                role="button"
                tabIndex={0}
                onClick={() => setOpen(a)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(a))}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-gradient-to-br from-accent-soft/60 to-surface p-4 shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
              >
                <AgentGlyph kind={a.kind} icon={a.icon} category={a.kind_category} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-ink">{a.name}</p>
                  <p className="line-clamp-2 text-[12.5px] leading-snug text-ink-2">{a.everyday_use || a.tagline}</p>
                </div>
                {activateBtn(a)}
              </div>
            ))}
          </div>
          <h2 className="mt-10 text-[15px] font-semibold text-ink">All agents</h2>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((a) => (
          <div
            key={a.key}
            role="button"
            tabIndex={0}
            onClick={() => setOpen(a)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(a))}
            className="group flex cursor-pointer flex-col rounded-xl border border-line bg-surface p-5 shadow-sm transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-md focus-visible:outline-2"
          >
            <div className="flex items-start justify-between gap-3">
              <AgentGlyph kind={a.kind} icon={a.icon} category={a.kind_category} size="lg" />
              <div className="flex items-center gap-1.5">
                {a.availability === "beta" ? <Badge tone="warn">Beta</Badge> : null}
                <TierBadge tier={a.pricing.tier} />
              </div>
            </div>
            <p className="mt-4 text-[15px] font-semibold text-ink">{a.name}</p>
            <p className="mt-1.5 line-clamp-2 flex-1 text-[14px] leading-snug font-medium text-ink">{a.everyday_use || a.tagline}</p>
            {a.everyday_use ? <p className="mt-1 line-clamp-1 text-[12.5px] text-muted">{a.tagline}</p> : null}
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                {a.activated_agent_ids.length ? (
                  <>
                    <Check className="size-3.5 text-ok" /> Active ×{a.activated_agent_ids.length}
                  </>
                ) : (
                  <>
                    <span className="size-1.5 rounded-full" style={{ background: CATEGORY_META[a.kind_category]?.color }} /> {CAT_LABEL[a.category]}
                  </>
                )}
              </span>
              {activateBtn(a)}
            </div>
          </div>
        ))}
      </div>

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.name ?? ""}
        width="w-[520px]"
        footer={
          open ? (
            <>
              {open.activated_agent_ids.length ? (
                <Link href={`/agents/${open.activated_agent_ids[0]}`} className="mr-auto inline-flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-accent">
                  Open active agent <ArrowRight className="size-3.5" />
                </Link>
              ) : null}
              {activateBtn(open, "md")}
            </>
          ) : null
        }
      >
        {open ? (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <AgentGlyph kind={open.kind} icon={open.icon} category={open.kind_category} size="lg" />
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <TierBadge tier={open.pricing.tier} />
                  <Badge>v{open.version}</Badge>
                  {open.availability === "beta" ? <Badge tone="warn">Beta</Badge> : null}
                </div>
                {open.everyday_use ? <p className="mt-2 text-[15px] leading-snug font-medium text-ink">{open.everyday_use}</p> : null}
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{open.description}</p>
                {open.pricing.note ? <p className="mt-1 text-xs text-muted">{open.pricing.note}</p> : null}
              </div>
            </div>
            <DrawerList title="What it can do" items={open.capabilities} />
            <div>
              <p className="mb-2 text-[12px] font-medium text-muted">Tools it uses</p>
              <div className="flex flex-wrap gap-1.5">
                {open.tools.map((t) => (
                  <span key={t} className="rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11.5px] text-ink-2">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            {open.integrations.length ? (
              <div>
                <p className="mb-2 text-[12px] font-medium text-muted">Works with</p>
                <div className="flex flex-wrap gap-1.5">
                  {open.integrations.map((k) => (
                    <Badge key={k}>{k.replace("_", " ")}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {open.required_config.length ? (
              <div>
                <p className="mb-2 text-[12px] font-medium text-muted">You&apos;ll set</p>
                <p className="text-[13px] text-ink-2">{open.required_config.map((c) => c.replace(/_/g, " ")).join(", ")}</p>
              </div>
            ) : null}
            <DrawerList title="Example workflows" items={open.example_workflows} />
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <BookOpen className="size-3.5" /> Docs: <span className="font-mono">{open.docs}</span> · runs on the <span className="font-mono">{open.kind}</span> engine
            </p>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function DrawerList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-2 text-[12px] font-medium text-muted">{title}</p>
      <ul className="space-y-1.5">
        {items.map((c) => (
          <li key={c} className={cn("flex items-start gap-2 text-[13px] text-ink")}>
            <Check className="mt-0.5 size-3.5 shrink-0 text-ok" /> {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
