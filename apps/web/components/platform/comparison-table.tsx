"use client";

// Side-by-side comparison of dataset records (assistant answers, dataset previews) plus the per-field-type value
// formatting shared by every dataset view: currency in ₹ with Indian grouping, numbers with units, ratings, lists,
// links, booleans and dates.
import { Check, Minus, Star, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { inr } from "@/components/platform/kit";
import { dateTime, hostOf } from "@/lib/format";
import type { ComparisonTable as ComparisonTableData, DatasetField } from "@/lib/platform-types";

/* ---------------- Value formatting ---------------- */

const isBlank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[,₹\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function plainNumber(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

/** Currency in rupees by default; a unit like "₹ Cr" keeps its suffix, a non-rupee unit is used as the symbol. */
export function formatCurrency(n: number, unit?: string): string {
  const u = (unit ?? "₹").trim();
  if (!u || u.startsWith("₹")) {
    const suffix = u.slice(1).trim();
    return `${inr(n)}${suffix ? ` ${suffix}` : ""}`;
  }
  return `${u} ${plainNumber(n)}`;
}

function withUnit(n: number, unit?: string): string {
  if (!unit) return plainNumber(n);
  if (unit === "%" || unit === "x" || unit === "×") return `${plainNumber(n)}${unit}`;
  if (unit.startsWith("₹")) return formatCurrency(n, unit);
  return `${plainNumber(n)} ${unit}`;
}

/** Plain-text rendering of a value (tables, CSV previews, titles). */
export function formatFieldText(field: Pick<DatasetField, "type" | "unit">, value: unknown): string {
  if (isBlank(value)) return "—";
  switch (field.type) {
    case "currency": {
      const n = toNumber(value);
      return n === null ? String(value) : formatCurrency(n, field.unit);
    }
    case "number": {
      const n = toNumber(value);
      return n === null ? String(value) : withUnit(n, field.unit);
    }
    case "rating": {
      const n = toNumber(value);
      return n === null ? String(value) : `${n.toFixed(1)} ★`;
    }
    case "list":
      return Array.isArray(value) ? value.map(String).join(", ") : String(value);
    case "url":
      return hostOf(String(value));
    case "boolean":
      return value === true || value === "true" ? "Yes" : value === false || value === "false" ? "No" : String(value);
    case "date":
      return typeof value === "string" ? dateTime(value, "d MMM yyyy") : String(value);
    default:
      return Array.isArray(value) ? value.map(String).join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** Rich rendering of a value: chips for lists, a host link for URLs, a star for ratings, icons for booleans. */
export function FieldValue({ field, value, className, maxChips = 3 }: { field: Pick<DatasetField, "type" | "unit">; value: unknown; className?: string; maxChips?: number }) {
  if (isBlank(value)) return <span className={cn("text-muted", className)}>—</span>;
  switch (field.type) {
    case "list": {
      const items = Array.isArray(value) ? value.map(String) : String(value).split(/\s*,\s*/).filter(Boolean);
      const shown = items.slice(0, maxChips);
      return (
        <span className={cn("inline-flex flex-wrap gap-1", className)}>
          {shown.map((t) => (
            <span key={t} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] whitespace-nowrap text-ink-2">
              {t}
            </span>
          ))}
          {items.length > shown.length ? <span className="px-0.5 text-[11.5px] text-muted">+{items.length - shown.length}</span> : null}
        </span>
      );
    }
    case "url": {
      const href = String(value);
      const safe = /^https?:\/\//i.test(href) ? href : `https://${href}`;
      return (
        <a href={safe} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={cn("text-accent hover:underline", className)}>
          {hostOf(safe)}
        </a>
      );
    }
    case "rating": {
      const n = toNumber(value);
      if (n === null) return <span className={className}>{String(value)}</span>;
      return (
        <span className={cn("inline-flex items-center gap-1 tabular", className)}>
          {n.toFixed(1)}
          <Star className="size-3 fill-warn text-warn" aria-label="stars" />
        </span>
      );
    }
    case "boolean": {
      const yes = value === true || value === "true";
      return yes ? (
        <span className={cn("inline-flex items-center gap-1 text-ok", className)}>
          <Check className="size-3.5" aria-hidden /> Yes
        </span>
      ) : (
        <span className={cn("inline-flex items-center gap-1 text-muted", className)}>
          <Minus className="size-3.5" aria-hidden /> No
        </span>
      );
    }
    case "currency":
    case "number":
      return <span className={cn("tabular", className)}>{formatFieldText(field, value)}</span>;
    default:
      return <span className={className}>{formatFieldText(field, value)}</span>;
  }
}

/* ---------------- Comparison table ---------------- */

/**
 * Records as columns, fields as rows: reads best for the usual 2–4 records. The best value in each row (per
 * `winners`) is tinted with the accent colour and marked with a trophy. Scrolls horizontally on small screens.
 */
export function ComparisonTable({ table, className, caption }: { table: ComparisonTableData; className?: string; caption?: ReactNode }) {
  if (!table.rows.length || !table.fields.length) return null;
  const wins: Record<string, number> = {};
  for (const rk of Object.values(table.winners)) wins[rk] = (wins[rk] ?? 0) + 1;
  const most = Math.max(0, ...Object.values(wins));

  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-surface shadow-sm", className)}>
      {caption ? <div className="border-b border-line px-4 py-2.5 text-[12px] text-muted">{caption}</div> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left text-[11px] font-medium tracking-wide text-muted uppercase">
                <span className="sr-only">Field</span>
              </th>
              {table.rows.map((r) => (
                <th key={r.key} scope="col" className="min-w-[150px] px-4 py-3 text-left align-bottom">
                  <span className="block text-[13.5px] leading-snug font-semibold text-ink">{r.key}</span>
                  {wins[r.key] ? (
                    <span className={cn("mt-1 inline-flex items-center gap-1 text-[11px] font-medium", wins[r.key] === most ? "text-accent" : "text-muted")}>
                      <Trophy className="size-3" aria-hidden />
                      {wins[r.key]} best
                    </span>
                  ) : (
                    <span className="mt-1 block text-[11px] text-transparent select-none" aria-hidden>
                      ·
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.fields.map((f) => {
              const winner = table.winners[f.key];
              return (
                <tr key={f.key} className="border-b border-line last:border-b-0">
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2.5 text-left text-[12.5px] font-normal whitespace-nowrap text-ink-2">
                    {f.label}
                    {f.higher_is_better !== undefined ? <span className="ml-1 text-[11px] text-muted">{f.higher_is_better ? "↑" : "↓"}</span> : null}
                  </th>
                  {table.rows.map((r) => {
                    const isWin = winner === r.key;
                    return (
                      <td key={r.key} className={cn("px-4 py-2.5 align-middle", isWin && "bg-accent-soft")}>
                        <span className={cn("inline-flex items-center gap-1.5", isWin ? "font-semibold text-accent" : "text-ink")}>
                          <FieldValue field={f} value={r.values[f.key]} />
                          {isWin ? <Trophy className="size-3.5 shrink-0" aria-label="Best" /> : null}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
