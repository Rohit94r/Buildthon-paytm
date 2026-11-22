"use client";

import { format, parseISO } from "date-fns";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Day = { day: string; succeeded: number; failed: number };

function dayLabel(d: string) {
  try {
    return format(parseISO(d), "d MMM");
  } catch {
    return d;
  }
}

function RunsTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey?: string | number; value?: number }[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  const v = (k: string) => payload.find((p) => p.dataKey === k)?.value ?? 0;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-ink">{dayLabel(String(label))}</p>
      <p className="flex items-center gap-2 text-ink-2">
        <span className="size-2 rounded-sm bg-ok" /> Succeeded <span className="ml-auto pl-3 font-medium text-ink tabular">{v("succeeded")}</span>
      </p>
      <p className="flex items-center gap-2 text-ink-2">
        <span className="size-2 rounded-sm bg-bad" /> Failed <span className="ml-auto pl-3 font-medium text-ink tabular">{v("failed")}</span>
      </p>
    </div>
  );
}

/** Daily runs, succeeded + failed stacked (status colours, legend + tooltip). */
export function RunsChart({ data, height = 200 }: { data: Day[]; height?: number }) {
  const total = data.reduce((a, d) => a + d.succeeded + d.failed, 0);
  const failed = data.reduce((a, d) => a + d.failed, 0);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-ok" /> Succeeded
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-bad" /> Failed
        </span>
        <span className="ml-auto text-muted tabular">
          {total} runs · {failed} failed
        </span>
      </div>
      <div style={{ height }} role="img" aria-label={`Runs per day over ${data.length} days: ${total} total, ${failed} failed`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -24 }} barCategoryGap="28%" maxBarSize={14}>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="0" />
            <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={48} />
            <Tooltip content={<RunsTooltip />} cursor={{ fill: "var(--surface-2)" }} />
            <Bar dataKey="succeeded" stackId="r" fill="var(--ok)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="failed" stackId="r" fill="var(--bad)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
