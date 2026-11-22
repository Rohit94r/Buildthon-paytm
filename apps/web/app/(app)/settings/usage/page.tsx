"use client";

import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Check, Users } from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Banner, Card, PageHeader, QueryView, Skeleton, cn } from "@/components/ui";
import { AgentGlyph, Empty, Kpi, Section, inr } from "@/components/platform/kit";
import { get } from "@/lib/api";
import { ago, dateTime, ms, num, pct } from "@/lib/format";
import type { AgentUsage, Plan, WorkspaceUsage, WorkspaceUsageWithAgents } from "@/lib/platform-ops-types";

const limitText = (n: number) => (n === -1 ? "Unlimited" : num(n));
const priceText = (p: Plan) => (p.price_inr_month === null ? "Custom" : p.price_inr_month === 0 ? "Free" : `${inr(p.price_inr_month)}/month`);

function compact(n: number): string {
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export default function UsagePage() {
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => get<WorkspaceUsageWithAgents>("/usage") });

  return (
    <div className="mx-auto max-w-[1040px]">
      <PageHeader title="Usage & plan" subtitle="What this workspace uses against its plan's limits." />
      <QueryView
        query={usage}
        skeleton={
          <div className="space-y-4">
            <Skeleton className="h-[120px] rounded-xl" />
            <Skeleton className="h-[220px] rounded-xl" />
            <Skeleton className="h-[260px] rounded-xl" />
          </div>
        }
      >
        {(u) => <UsageView u={u} />}
      </QueryView>
    </div>
  );
}

function UsageView({ u }: { u: WorkspaceUsage & { by_agent?: AgentUsage[] } }) {
  const L = u.plan.limits;
  const meters: { label: string; used: number; limit: number; hint?: string }[] = [
    { label: "Agents", used: u.usage.agents, limit: L.agents },
    { label: "Members", used: u.usage.members, limit: L.members },
    { label: "Dataset records", used: u.usage.records, limit: L.records },
    { label: "Runs today", used: u.usage.runs_today, limit: L.runs_per_day, hint: u.usage.running_now ? `${u.usage.running_now} running now · ${L.concurrent_runs} at a time` : `${L.concurrent_runs} at a time` },
    { label: "API calls today", used: u.usage.api_calls_today, limit: L.api_calls_per_day },
  ];

  return (
    <div className="space-y-10">
      {/* Plan */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[12px] font-medium text-muted">Current plan</p>
              {L.premium_agents ? <Badge tone="accent">Premium agents</Badge> : null}
            </div>
            <p className="mt-1 font-display text-[26px] leading-tight font-semibold text-ink">{u.plan.name}</p>
            <p className="mt-1 max-w-lg text-[13.5px] text-ink-2">{u.plan.description}</p>
          </div>
          <div className="text-right">
            <p className="text-[20px] font-semibold text-ink tabular">{priceText(u.plan)}</p>
            <p className="mt-1 text-xs text-muted">Period since {dateTime(u.period_start, "d MMM yyyy")}</p>
          </div>
        </div>
      </Card>

      {/* Limits */}
      <Section title="Limits">
        <Card className="divide-y divide-line">
          {meters.map((m) => (
            <Meter key={m.label} {...m} />
          ))}
        </Card>
      </Section>

      {/* Chart */}
      <Section title="Runs per day" subtitle="Last 30 days">
        <Card className="px-2 pt-5 pb-2 sm:px-4">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={u.by_day} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d: string) => format(parseISO(d), "d MMM")}
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis allowDecimals={false} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, color: "var(--ink)", boxShadow: "0 4px 16px rgb(0 0 0 / 0.08)" }}
                  labelStyle={{ color: "var(--muted)", marginBottom: 2 }}
                  itemStyle={{ color: "var(--ink)" }}
                  labelFormatter={(d) => format(parseISO(String(d)), "EEE, d MMM")}
                  formatter={(v) => [num(Number(v)), "Runs"]}
                />
                <Bar dataKey="runs" name="Runs" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Section>

      {/* Monthly totals */}
      <Section title="This month">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Runs" value={num(u.usage.runs_month)} />
          <Kpi label="Model tokens" value={compact(u.usage.model_tokens_month)} hint={`${num(u.usage.model_tokens_month)} tokens`} />
          <Kpi label="Model calls" value={num(u.usage.model_calls_month)} />
          <Kpi label="Items processed" value={num(u.usage.items_processed_month)} />
        </div>
      </Section>

      <UsageByAgent rows={u.by_agent ?? []} />

      <Banner tone="neutral" title="Billing">
        {u.billing_note}
      </Banner>

      <ComparePlans current={u.plan.key} />
    </div>
  );
}

/** "48.2k", "1.3m": short token counts for the per-agent table. */
function short(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n).toLowerCase();
}

function UsageByAgent({ rows }: { rows: AgentUsage[] }) {
  const sorted = [...rows].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
  const totalRuns = sorted.reduce((sum, r) => sum + r.runs, 0);
  return (
    <Section title="Usage by agent" subtitle="This month, busiest agents first.">
      {totalRuns === 0 ? (
        <Empty icon={<Users />} title="No runs yet this month" body="When your agents run, you'll see here how much each one did and how much AI it used." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead className="border-b border-line">
              <tr className="text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                <th className="px-4 py-2.5">Agent</th>
                <th className="px-3 py-2.5 text-right">Runs</th>
                <th className="px-3 py-2.5">Share of runs</th>
                <th className="px-3 py-2.5 text-right">Success</th>
                <th className="px-3 py-2.5 text-right">Items</th>
                <th className="px-3 py-2.5 text-right" title="AI model calls · tokens used">
                  AI calls · tokens
                </th>
                <th className="px-3 py-2.5 text-right">Avg time</th>
                <th className="px-4 py-2.5 text-right">Last run</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const share = totalRuns ? a.runs / totalRuns : 0;
                const success = a.runs ? a.succeeded / a.runs : null;
                return (
                  <tr key={a.agent_id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/agents/${a.agent_id}`} className="group flex min-w-0 items-center gap-2.5">
                        <AgentGlyph kind={a.kind} size="sm" />
                        <span className="truncate font-medium text-ink group-hover:text-accent group-hover:underline">{a.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-ink tabular">{num(a.runs)}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2" aria-label={`${pct(share)} of all runs`}>
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(share > 0 ? 3 : 0, share * 100)}%` }} />
                        </div>
                        <span className="w-10 text-[12px] text-ink-2 tabular">{pct(share)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular">
                      {success === null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className={cn(success >= 0.9 ? "text-ok" : success >= 0.7 ? "text-ink" : "text-warn")} title={`${num(a.succeeded)} succeeded, ${num(a.failed)} failed`}>
                          {pct(success)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-ink-2 tabular">{num(a.items_out)}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap text-ink-2 tabular" title={`${num(a.model_calls)} AI calls · ${num(a.model_tokens)} tokens`}>
                      {num(a.model_calls)} · {short(a.model_tokens)}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap text-ink-2 tabular">{ms(a.avg_duration_ms)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-muted" title={a.last_run_at ? dateTime(a.last_run_at) : undefined}>
                      {ago(a.last_run_at, "Never")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}

function Meter({ label, used, limit, hint }: { label: string; used: number; limit: number; hint?: string }) {
  const unlimited = limit === -1;
  const ratio = unlimited || limit <= 0 ? 0 : used / limit;
  const tone = ratio >= 1 ? "bg-bad" : ratio >= 0.8 ? "bg-warn" : "bg-accent";
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="text-[13px] text-ink-2 tabular">
          <span className={cn("font-semibold", ratio >= 1 ? "text-bad" : "text-ink")}>{num(used)}</span>
          <span className="text-muted"> / {limitText(limit)}</span>
        </p>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={unlimited ? undefined : limit}
      >
        {unlimited ? <div className="h-full w-full bg-accent/25" /> : <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />}
      </div>
      {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function ComparePlans({ current }: { current: Plan["key"] }) {
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => get<{ items: Plan[] }>("/plans"), staleTime: 5 * 60_000 });
  return (
    <Section title="Compare plans" subtitle="Plan changes are made by a LayerFlow platform admin. There is no self-serve checkout yet.">
      <QueryView query={plans} isEmpty={(d) => d.items.length === 0} empty={<p className="text-[13px] text-muted">No plans are configured on this server.</p>}>
        {(d) => (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="border-b border-line">
                <tr className="text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                  <th className="px-4 py-2.5">Plan</th>
                  <th className="px-3 py-2.5">Price</th>
                  <th className="px-3 py-2.5">Agents</th>
                  <th className="px-3 py-2.5">Runs / day</th>
                  <th className="px-3 py-2.5">Records</th>
                  <th className="px-3 py-2.5">Members</th>
                  <th className="px-3 py-2.5">Premium</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((p) => {
                  const isCurrent = p.key === current;
                  return (
                    <tr key={p.key} className={cn("border-b border-line last:border-0", isCurrent && "bg-accent-soft")}>
                      <td className="px-4 py-3">
                        <p className="flex items-center gap-2 font-medium text-ink">
                          {p.name}
                          {isCurrent ? <Badge tone="accent">Current</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">{p.description}</p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink tabular">{priceText(p)}</td>
                      <td className="px-3 py-3 text-ink-2 tabular">{limitText(p.limits.agents)}</td>
                      <td className="px-3 py-3 text-ink-2 tabular">{limitText(p.limits.runs_per_day)}</td>
                      <td className="px-3 py-3 text-ink-2 tabular">{limitText(p.limits.records)}</td>
                      <td className="px-3 py-3 text-ink-2 tabular">{limitText(p.limits.members)}</td>
                      <td className="px-3 py-3">{p.limits.premium_agents ? <Check className="size-4 text-ok" aria-label="Yes" /> : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </QueryView>
    </Section>
  );
}
