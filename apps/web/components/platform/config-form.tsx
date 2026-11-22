"use client";

// Renders an agent's config_schema (every FieldType) as a calm, vertical form. Values are kept as plain JSON.
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Plus, Trash2, X } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Input, Select, Textarea, Toggle, cn } from "@/components/ui";
import { get } from "@/lib/api";
import type { ConfigField, Connection, ContentFormat, Dataset } from "@/lib/platform-types";

export const FORMAT_LABEL: Record<ContentFormat, string> = {
  article: "Article",
  blog_post: "Blog post",
  linkedin_post: "LinkedIn post",
  x_thread: "X thread",
  instagram_caption: "Instagram caption",
  facebook_post: "Facebook post",
  newsletter: "Newsletter",
  short_video_script: "Video script",
  whatsapp_message: "WhatsApp message",
};

type Value = Record<string, unknown>;

export function defaultsFor(schema: ConfigField[]): Value {
  const out: Value = {};
  for (const f of schema) if (f.default !== undefined) out[f.key] = JSON.parse(JSON.stringify(f.default));
  return out;
}

/** Required fields that are empty → list of labels. */
export function missingRequired(schema: ConfigField[], value: Value): string[] {
  return schema
    .filter((f) => f.required)
    .filter((f) => {
      const v = value[f.key];
      return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    })
    .map((f) => f.label);
}

const JSON_TEXT_KEYS = new Set(["filters", "rename_fields", "set_fields", "assign_rules", "body_template"]);

export function ConfigForm({ schema, value, onChange, disabled, compact }: { schema: ConfigField[]; value: Value; onChange: (v: Value) => void; disabled?: boolean; compact?: boolean }) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  if (!schema.length) return <p className="text-[13px] text-muted">This agent has no settings.</p>;
  return (
    <div className={cn("space-y-5", compact && "space-y-4")}>
      {schema.map((f) => (
        <div key={f.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label className="text-[13px] font-medium text-ink" htmlFor={`cf-${f.key}`}>
              {f.label}
              {f.required ? <span className="ml-0.5 text-bad">*</span> : null}
            </label>
            {f.secret ? <span className="text-[11px] text-muted">write-only</span> : null}
          </div>
          <FieldControl field={f} value={value[f.key]} onChange={(v) => set(f.key, v)} disabled={disabled} />
          {f.help && f.type !== "boolean" && f.key !== "filters" ? <p className="mt-1.5 text-xs text-muted">{f.help}</p> : null}
        </div>
      ))}
    </div>
  );
}

function FieldControl({ field: f, value, onChange, disabled }: { field: ConfigField; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const id = `cf-${f.key}`;
  switch (f.type) {
    case "text":
      return <Input id={id} value={String(value ?? "")} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} type={f.secret ? "password" : "text"} />;
    case "textarea":
      if (f.key === "filters") return <FilterRules value={value} onChange={onChange} disabled={disabled} />;
      if (JSON_TEXT_KEYS.has(f.key) || Array.isArray(value) || (value && typeof value === "object")) return <JsonText id={id} value={value} onChange={onChange} disabled={disabled} />;
      return <Textarea id={id} rows={4} value={String(value ?? "")} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "number":
      return (
        <Input
          id={id}
          type="number"
          className="max-w-[180px]"
          value={value === null || value === undefined ? "" : String(value)}
          min={f.min}
          max={f.max}
          step={typeof f.default === "number" && !Number.isInteger(f.default) ? 0.1 : 1}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          disabled={disabled}
        />
      );
    case "boolean":
      return (
        <div className="flex items-center gap-3">
          <Toggle checked={Boolean(value)} onChange={onChange} label={f.label} disabled={disabled} />
          {f.help ? <span className="text-xs text-muted">{f.help}</span> : null}
        </div>
      );
    case "select":
      return (
        <Select id={id} className="max-w-sm" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {!f.required ? <option value="">—</option> : null}
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "multiselect":
      return <ChipSelect options={f.options ?? []} value={asArray(value)} onChange={onChange} disabled={disabled} />;
    case "formats":
      return <ChipSelect options={(f.options?.length ? f.options : Object.entries(FORMAT_LABEL).map(([v, l]) => ({ value: v, label: l })))} value={asArray(value)} onChange={onChange} disabled={disabled} />;
    case "string_list":
      return <TagInput value={asArray(value)} onChange={onChange} placeholder={f.placeholder ?? "Type and press Enter"} disabled={disabled} />;
    case "sources":
      return <SourcesEditor value={Array.isArray(value) ? (value as SourceRow[]) : []} onChange={onChange} disabled={disabled} />;
    case "extract_fields":
      return <ExtractFieldsEditor value={Array.isArray(value) ? (value as ExtractRow[]) : []} onChange={onChange} disabled={disabled} />;
    case "connections":
      return <ConnectionsPicker value={asArray(value)} onChange={onChange} disabled={disabled} />;
    case "dataset":
      return <DatasetPicker id={id} value={value ? String(value) : ""} onChange={onChange} disabled={disabled} />;
    case "model":
      return <ModelPicker id={id} field={f} value={String(value ?? f.default ?? "fast")} onChange={onChange} disabled={disabled} />;
    default:
      return <JsonText id={id} value={value} onChange={onChange} disabled={disabled} />;
  }
}

const asArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);

function ChipSelect({ options, value, onChange, disabled }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] transition-colors disabled:opacity-60",
              on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong",
            )}
          >
            {on ? <Check className="size-3.5" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function TagInput({ value, onChange, placeholder, disabled }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.includes(s));
    if (parts.length) onChange([...value, ...parts]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className={cn("flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 py-1.5 shadow-sm focus-within:border-accent", disabled && "opacity-60")}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[12.5px] text-ink">
          {t}
          {!disabled ? (
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="text-muted hover:text-ink" aria-label={`Remove ${t}`}>
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder={value.length ? "" : placeholder} disabled={disabled} className="min-w-[120px] flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted" />
    </div>
  );
}

interface SourceRow {
  url: string;
  type?: string;
  name?: string;
}
function SourcesEditor({ value, onChange, disabled }: { value: SourceRow[]; onChange: (v: SourceRow[]) => void; disabled?: boolean }) {
  const update = (i: number, patch: Partial<SourceRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {value.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Select className="w-[110px] shrink-0" value={r.type ?? "html"} onChange={(e) => update(i, { type: e.target.value })} disabled={disabled} aria-label="Source type">
            {["rss", "html", "sitemap", "json"].map((t) => (
              <option key={t} value={t}>
                {t.toUpperCase()}
              </option>
            ))}
          </Select>
          <Input value={r.url} placeholder="https://…" onChange={(e) => update(i, { url: e.target.value })} disabled={disabled} aria-label="Source URL" />
          <IconBtn label="Remove source" onClick={() => onChange(value.filter((_, j) => j !== i))} disabled={disabled}>
            <Trash2 className="size-3.5" />
          </IconBtn>
        </div>
      ))}
      <AddRow onClick={() => onChange([...value, { url: "", type: "rss" }])} disabled={disabled}>
        Add source
      </AddRow>
    </div>
  );
}

interface ExtractRow {
  key: string;
  label?: string;
  type?: string;
  selector?: string;
  description?: string;
}
function ExtractFieldsEditor({ value, onChange, disabled }: { value: ExtractRow[]; onChange: (v: ExtractRow[]) => void; disabled?: boolean }) {
  const update = (i: number, patch: Partial<ExtractRow>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {value.length ? (
        <div className="hidden grid-cols-[1fr_1fr_110px_1fr_auto] gap-2 px-0.5 text-[11px] font-medium text-muted sm:grid">
          <span>Key</span>
          <span>Label</span>
          <span>Type</span>
          <span>Selector / hint</span>
          <span className="w-[84px]" />
        </div>
      ) : null}
      {value.map((r, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_110px_1fr_auto]">
          <Input value={r.key} placeholder="registration_deadline" onChange={(e) => update(i, { key: e.target.value.replace(/\s+/g, "_").toLowerCase() })} disabled={disabled} aria-label="Field key" className="font-mono text-[12px]" />
          <Input value={r.label ?? ""} placeholder="Deadline" onChange={(e) => update(i, { label: e.target.value })} disabled={disabled} aria-label="Field label" />
          <Select value={r.type ?? "text"} onChange={(e) => update(i, { type: e.target.value })} disabled={disabled} aria-label="Field type">
            {["text", "number", "currency", "date", "url", "list", "boolean", "rating"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Input value={r.selector ?? r.description ?? ""} placeholder="AI reads the page (optional CSS)" onChange={(e) => update(i, r.selector !== undefined || e.target.value.match(/^[.#\[a-z]/) ? { selector: e.target.value } : { description: e.target.value })} disabled={disabled} aria-label="Selector or hint" />
          <div className="flex gap-1">
            <IconBtn label="Move up" onClick={() => move(i, -1)} disabled={disabled || i === 0}>
              <ArrowUp className="size-3.5" />
            </IconBtn>
            <IconBtn label="Move down" onClick={() => move(i, 1)} disabled={disabled || i === value.length - 1}>
              <ArrowDown className="size-3.5" />
            </IconBtn>
            <IconBtn label="Remove field" onClick={() => onChange(value.filter((_, j) => j !== i))} disabled={disabled}>
              <Trash2 className="size-3.5" />
            </IconBtn>
          </div>
        </div>
      ))}
      <AddRow onClick={() => onChange([...value, { key: "", label: "", type: "text" }])} disabled={disabled}>
        Add field
      </AddRow>
    </div>
  );
}

function ConnectionsPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const q = useQuery({ queryKey: ["connections"], queryFn: () => get<{ items: Connection[] }>("/connections") });
  if (q.isPending) return <p className="text-[13px] text-muted">Loading connections…</p>;
  const items = q.data?.items ?? [];
  if (!items.length)
    return (
      <p className="text-[13px] text-muted">
        No connections yet.{" "}
        <a href="/connections" className="text-accent hover:underline">
          Connect a site or channel
        </a>
      </p>
    );
  return <ChipSelect options={items.map((c) => ({ value: c.id, label: `${c.name}${c.status !== "connected" ? " (needs setup)" : ""}` }))} value={value} onChange={onChange} disabled={disabled} />;
}

function DatasetPicker({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string | null) => void; disabled?: boolean }) {
  const q = useQuery({ queryKey: ["datasets"], queryFn: () => get<{ items: Dataset[] }>("/datasets") });
  return (
    <Select id={id} className="max-w-sm" value={value} onChange={(e) => onChange(e.target.value || null)} disabled={disabled || q.isPending}>
      <option value="">{q.isPending ? "Loading…" : "Choose a dataset"}</option>
      {(q.data?.items ?? []).map((d) => (
        <option key={d.id} value={d.id}>
          {d.name} · {d.record_count} records
        </option>
      ))}
    </Select>
  );
}

function ModelPicker({ id, field, value, onChange, disabled }: { id: string; field: ConfigField; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const opts = field.options?.length
    ? field.options
    : [
        { value: "fast", label: "Fast · qwen2.5:7b" },
        { value: "writer", label: "Writer · qwen2.5:14b" },
      ];
  const custom = !opts.some((o) => o.value === value);
  return (
    <div className="flex max-w-lg flex-wrap gap-2">
      <Select id={id} className="max-w-[240px]" value={custom ? "__custom" : value} onChange={(e) => onChange(e.target.value === "__custom" ? "" : e.target.value)} disabled={disabled}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value="__custom">Custom model tag…</option>
      </Select>
      {custom ? <Input className="max-w-[220px] font-mono text-[12px]" value={value} placeholder="llama3.1:8b" onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label="Model tag" /> : null}
    </div>
  );
}

/* JSON text (backend stores some fields as JSON strings). Keeps the incoming type: string in → string out. */
function JsonText({ id, value, onChange, disabled }: { id: string; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const asString = typeof value === "string";
  const [text, setText] = useState(() => (asString ? (value as string) : JSON.stringify(value ?? null, null, 2)));
  let error: string | null = null;
  try {
    if (text.trim()) JSON.parse(text);
  } catch (e) {
    error = e instanceof Error ? e.message : "Invalid JSON";
  }
  return (
    <div>
      <Textarea
        id={id}
        rows={5}
        className={cn("font-mono text-[12px]", error && "border-bad")}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = e.target.value.trim() ? JSON.parse(e.target.value) : asString ? "" : null;
            onChange(asString ? e.target.value : parsed);
          } catch {
            if (asString) onChange(e.target.value);
          }
        }}
      />
      <p className={cn("mt-1 text-[11px]", error ? "text-bad" : "text-ok")}>{error ? `JSON error: ${error}` : "Valid JSON"}</p>
    </div>
  );
}

/* ---------------- Filter rule builder (data_transform.filters) ---------------- */
interface Rule {
  field: string;
  op: string;
  value?: unknown;
}
const OPS: { value: string; label: string; needsValue: boolean }[] = [
  { value: "eq", label: "equals", needsValue: true },
  { value: "neq", label: "is not", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "not_contains", label: "doesn't contain", needsValue: true },
  { value: "gt", label: ">", needsValue: true },
  { value: "gte", label: "≥", needsValue: true },
  { value: "lt", label: "<", needsValue: true },
  { value: "lte", label: "≤", needsValue: true },
  { value: "exists", label: "has a value", needsValue: false },
  { value: "date_after_today", label: "is after today", needsValue: false },
  { value: "date_within_days", label: "is within N days", needsValue: true },
];

function parseRules(v: unknown): { rules: Rule[]; ok: boolean } {
  if (Array.isArray(v)) return { rules: v as Rule[], ok: true };
  if (typeof v === "string") {
    if (!v.trim()) return { rules: [], ok: true };
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? { rules: p, ok: true } : { rules: [], ok: false };
    } catch {
      return { rules: [], ok: false };
    }
  }
  return { rules: [], ok: true };
}

export function FilterRules({ value, onChange, disabled }: { value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const asString = typeof value === "string" || value === undefined || value === null;
  const { rules, ok } = parseRules(value);
  const [raw, setRaw] = useState(!ok);
  const emit = (next: Rule[]) => onChange(asString ? JSON.stringify(next) : next);
  const update = (i: number, patch: Partial<Rule>) => emit(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  if (raw) return <JsonText id="filters-json" value={typeof value === "string" ? value : JSON.stringify(value ?? [], null, 2)} onChange={onChange} disabled={disabled} />;
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface-2/50 p-3">
      {rules.length === 0 ? <p className="px-1 text-[12.5px] text-muted">No rules: every item passes. Add a rule to keep only matching items.</p> : null}
      {rules.map((r, i) => {
        const op = OPS.find((o) => o.value === r.op);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-12 text-right text-[12px] text-muted">{i === 0 ? "Keep if" : "and"}</span>
            <Input className="w-[180px] font-mono text-[12px]" value={r.field} placeholder="registration_deadline" onChange={(e) => update(i, { field: e.target.value })} disabled={disabled} aria-label="Field" />
            <Select className="w-[160px]" value={r.op} onChange={(e) => update(i, { op: e.target.value, ...(OPS.find((o) => o.value === e.target.value)?.needsValue ? {} : { value: undefined }) })} disabled={disabled} aria-label="Operator">
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {op?.needsValue !== false ? (
              <Input
                className="w-[160px]"
                value={r.value === undefined || r.value === null ? "" : String(r.value)}
                placeholder={r.op === "date_within_days" ? "30" : "value"}
                onChange={(e) => {
                  const t = e.target.value;
                  update(i, { value: t !== "" && !Number.isNaN(Number(t)) && ["gt", "gte", "lt", "lte", "date_within_days"].includes(r.op) ? Number(t) : t });
                }}
                disabled={disabled}
                aria-label="Value"
              />
            ) : null}
            <IconBtn label="Remove rule" onClick={() => emit(rules.filter((_, j) => j !== i))} disabled={disabled}>
              <Trash2 className="size-3.5" />
            </IconBtn>
          </div>
        );
      })}
      <div className="flex items-center justify-between pt-1">
        <AddRow onClick={() => emit([...rules, { field: "", op: "eq", value: "" }])} disabled={disabled}>
          Add rule
        </AddRow>
        <button type="button" onClick={() => setRaw(true)} className="text-[11.5px] text-muted hover:text-ink">
          Edit as JSON
        </button>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:border-line-strong hover:text-ink disabled:opacity-40">
      {children}
    </button>
  );
}

function AddRow({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50">
      <Plus className="size-3.5" /> {children}
    </button>
  );
}
