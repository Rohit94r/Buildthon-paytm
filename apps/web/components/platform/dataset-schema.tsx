"use client";

// Field schema editor for datasets: used by "New dataset" (datasets list) and the Schema tab (dataset detail).
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Checkbox, cn, Input, Select } from "@/components/ui";
import type { DatasetField, DatasetFieldType } from "@/lib/platform-types";

export const FIELD_TYPES: { value: DatasetFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "rating", label: "Rating" },
  { value: "list", label: "List" },
  { value: "url", label: "URL" },
  { value: "boolean", label: "Yes / no" },
  { value: "date", label: "Date" },
];

/** Editable row: a DatasetField plus a stable id and whether the key still follows the label. */
export interface FieldDraft extends DatasetField {
  _id: string;
  _autoKey: boolean;
}

let seq = 0;
const rid = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

export const toKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 40);

export function toDrafts(fields: DatasetField[]): FieldDraft[] {
  return fields.map((f) => ({ ...f, _id: rid(), _autoKey: false }));
}

export function newDraft(partial: Partial<DatasetField> = {}): FieldDraft {
  return { key: "", label: "", type: "text", ...partial, _id: rid(), _autoKey: !partial.key };
}

/** Strips editor-only props and empty optionals. */
export function fromDrafts(drafts: FieldDraft[]): DatasetField[] {
  return drafts.map(({ _id, _autoKey, ...f }) => {
    void _id;
    void _autoKey;
    const out: DatasetField = { key: f.key.trim(), label: f.label.trim() || f.key.trim(), type: f.type };
    if (f.compare) out.compare = true;
    if (f.unit?.trim()) out.unit = f.unit.trim();
    if (f.higher_is_better !== undefined) out.higher_is_better = f.higher_is_better;
    return out;
  });
}

export function schemaError(drafts: FieldDraft[], keyField: string): string | null {
  if (!drafts.length) return "Add at least one field";
  const keys = drafts.map((d) => d.key.trim());
  const bad = keys.find((k) => !/^[a-z][a-z0-9_]*$/.test(k));
  if (bad !== undefined) return bad ? `“${bad}” is not a valid key: use lower_snake_case starting with a letter` : "Every field needs a key";
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) return `The key “${dup}” is used twice`;
  if (!keys.includes(keyField)) return "Pick the key field that identifies each record";
  return null;
}

const NUMERIC: DatasetFieldType[] = ["number", "currency", "rating", "date"];

export function SchemaEditor({ value, onChange, disabled }: { value: FieldDraft[]; onChange: (v: FieldDraft[]) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<FieldDraft>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_112px_72px_64px_92px_84px] gap-2 px-1 pb-1.5 text-[11px] font-medium text-muted md:grid">
        <span>Label</span>
        <span>Key</span>
        <span>Type</span>
        <span>Unit</span>
        <span className="text-center">Compare</span>
        <span>Best is</span>
        <span />
      </div>
      <ul className="space-y-2">
        {value.map((f, i) => {
          const canRank = !!f.compare && NUMERIC.includes(f.type);
          return (
            <li key={f._id} className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-2/40 p-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_112px_72px_64px_92px_84px] md:items-center md:border-0 md:bg-transparent md:p-0">
              <Input
                aria-label="Label"
                placeholder="Label, e.g. Total fees"
                value={f.label}
                disabled={disabled}
                onChange={(e) => set(i, { label: e.target.value, ...(f._autoKey ? { key: toKey(e.target.value) } : {}) })}
                className="col-span-2 md:col-span-1"
              />
              <Input aria-label="Key" placeholder="key" value={f.key} disabled={disabled} onChange={(e) => set(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"), _autoKey: false })} className="font-mono text-[12px]" />
              <Select aria-label="Type" value={f.type} disabled={disabled} onChange={(e) => set(i, { type: e.target.value as DatasetFieldType })}>
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Input aria-label="Unit" placeholder={f.type === "currency" ? "₹" : "unit"} value={f.unit ?? ""} disabled={disabled || !["number", "currency"].includes(f.type)} onChange={(e) => set(i, { unit: e.target.value })} />
              <label className="flex h-9 items-center gap-2 text-[12px] text-ink-2 md:justify-center">
                <Checkbox checked={!!f.compare} onChange={(v) => set(i, { compare: v, ...(v ? {} : { higher_is_better: undefined }) })} label="Show in comparisons" />
                <span className="md:sr-only">Compare</span>
              </label>
              <Select
                aria-label="Best value"
                value={f.higher_is_better === undefined ? "" : f.higher_is_better ? "high" : "low"}
                disabled={disabled || !canRank}
                title={canRank ? "Which value wins in comparisons" : "Turn on Compare for a number, currency, rating or date field"}
                onChange={(e) => set(i, { higher_is_better: e.target.value === "" ? undefined : e.target.value === "high" })}
              >
                <option value="">—</option>
                <option value="high">Higher</option>
                <option value="low">Lower</option>
              </Select>
              <div className="col-span-2 flex items-center justify-end gap-0.5 md:col-span-1">
                <IconBtn label="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </IconBtn>
                <IconBtn label="Move down" disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </IconBtn>
                <IconBtn label="Remove field" disabled={disabled || value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))} danger>
                  <Trash2 />
                </IconBtn>
              </div>
            </li>
          );
        })}
      </ul>
      <Button size="xs" variant="ghost" className="mt-2" icon={<Plus className="size-3.5" />} disabled={disabled} onClick={() => onChange([...value, newDraft()])}>
        Add field
      </Button>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:size-3.5", danger ? "hover:text-bad" : "hover:text-ink")}
    >
      {children}
    </button>
  );
}
