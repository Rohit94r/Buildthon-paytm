"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, ExternalLink, FileUp, Globe, Plus, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Banner, Button, Card, cn, Dialog, Drawer, Field, Input, PageHeader, QueryView, Select, Skeleton, Tabs, Textarea, Toggle } from "@/components/ui";
import { CodeBlock, Empty, SearchInput, usePermissions } from "@/components/platform/kit";
import { FieldValue, formatFieldText } from "@/components/platform/comparison-table";
import { fromDrafts, schemaError, SchemaEditor, toDrafts, type FieldDraft } from "@/components/platform/dataset-schema";
import { del, get, patch, post } from "@/lib/api";
import { ago, hostOf, num } from "@/lib/format";
import { useAction, useDebounced } from "@/lib/hooks";
import type { Dataset, DatasetField, DatasetRecord, Paged } from "@/lib/platform-types";

const PAGE = 25;
type TabKey = "records" | "schema" | "api";

export default function DatasetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: ["datasets", id], queryFn: () => get<Dataset>(`/datasets/${id}`), enabled: !!id });
  return (
    <div className="mx-auto max-w-[1200px]">
      <Link href="/datasets" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Datasets
      </Link>
      <QueryView
        query={query}
        skeleton={
          <div>
            <Skeleton className="mb-2 h-8 w-72" />
            <Skeleton className="mb-8 h-4 w-[28rem] max-w-full" />
            <Skeleton className="h-[420px] rounded-xl" />
          </div>
        }
      >
        {(ds) => <DatasetDetail ds={ds} />}
      </QueryView>
    </div>
  );
}

/* ====================================================================== */

function DatasetDetail({ ds }: { ds: Dataset }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { reason } = usePermissions();
  const denied = reason("data.edit");
  const [tab, setTab] = useState<TabKey>("records");
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<DatasetRecord | "new" | null>(null);

  const remove = useAction(() => del<void>(`/datasets/${ds.id}`), {
    success: `${ds.name} deleted`,
    onSuccess: () => {
      setDeleteOpen(false);
      void qc.invalidateQueries({ queryKey: ["datasets"], exact: true });
      router.push("/datasets");
    },
  });

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2.5">
            {ds.name}
            {ds.public ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-[3px] align-middle text-[11px] font-medium text-ok">
                <Globe className="size-3" aria-hidden /> Public
              </span>
            ) : (
              <span className="rounded-full bg-surface-2 px-2 py-[3px] text-[11px] font-medium text-muted">Private</span>
            )}
          </span>
        }
        subtitle={
          <>
            {ds.description ? <span className="block">{ds.description}</span> : null}
            <span className="mt-1 block text-[12.5px] text-muted">
              <span className="font-medium text-ink-2 tabular">{num(ds.record_count)}</span> records · {ds.fields.length} fields · updated {ago(ds.updated_at)}
            </span>
          </>
        }
        actions={
          <>
            <Button variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Delete dataset" title="Delete dataset" onClick={() => setDeleteOpen(true)} disabledReason={denied}>
              <span className="sr-only">Delete</span>
            </Button>
            <Button icon={<Upload className="size-3.5" />} onClick={() => setImportOpen(true)} disabledReason={denied}>
              Import
            </Button>
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")} disabledReason={denied}>
              Add record
            </Button>
          </>
        }
      />

      <Tabs<TabKey>
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "records", label: "Records", count: ds.record_count },
          { value: "schema", label: "Schema", count: ds.fields.length },
          { value: "api", label: "Public API" },
        ]}
      />

      {tab === "records" ? <RecordsTable ds={ds} onOpen={setEditing} onAdd={() => setEditing("new")} canAdd={!denied} /> : null}
      {tab === "schema" ? <SchemaTab ds={ds} denied={denied} /> : null}
      {tab === "api" ? <ApiTab ds={ds} denied={denied} /> : null}

      <RecordDrawer ds={ds} record={editing} onClose={() => setEditing(null)} denied={denied} />
      <ImportDialog ds={ds} open={importOpen} onClose={() => setImportOpen(false)} />
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        size="sm"
        title={`Delete ${ds.name}?`}
        description="All records are removed and the public API stops serving it. This can't be undone."
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(undefined)} data-autofocus>
              Delete dataset
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">
          {num(ds.record_count)} records in <span className="font-medium text-ink">{ds.name}</span> will be deleted. Agents that write to or read from it must be pointed elsewhere first.
        </p>
      </Dialog>
    </>
  );
}

/* ---------------- Records ---------------- */

function RecordsTable({ ds, onOpen, onAdd, canAdd }: { ds: Dataset; onOpen: (r: DatasetRecord) => void; onAdd: () => void; canAdd: boolean }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" } | null>(null);
  const [offset, setOffset] = useState(0);

  const records = useQuery({
    queryKey: ["datasets", ds.id, "records", { q, sort, offset }],
    queryFn: () => get<Paged<DatasetRecord>>(`/datasets/${ds.id}/records`, { q, sort: sort ? `${sort.field}:${sort.dir}` : undefined, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });

  const cycleSort = (field: string) => {
    setOffset(0);
    setSort((s) => (!s || s.field !== field ? { field, dir: "asc" } : s.dir === "asc" ? { field, dir: "desc" } : null));
  };

  // Key field first, then the rest in schema order.
  const columns = useMemo(() => {
    const kf = ds.fields.find((f) => f.key === ds.key_field);
    return kf ? [kf, ...ds.fields.filter((f) => f !== kf)] : ds.fields;
  }, [ds.fields, ds.key_field]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setOffset(0);
          }}
          placeholder={`Search ${ds.name.toLowerCase()}…`}
          className="w-full sm:w-80"
        />
        {sort ? (
          <button type="button" className="shrink-0 text-[12px] text-muted hover:text-ink" onClick={() => setSort(null)}>
            Clear sort
          </button>
        ) : null}
      </div>

      <QueryView
        query={records}
        skeleton={<Skeleton className="h-[360px] rounded-xl" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          q ? (
            <Empty title="No matching records" body={`Nothing in ${ds.name} matches “${q}”.`} />
          ) : (
            <Empty
              title="No records yet"
              body="Add one by hand, import a CSV or JSON file, or point a dataset builder agent at this dataset."
              action={
                canAdd ? (
                  <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={onAdd}>
                    Add record
                  </Button>
                ) : undefined
              }
            />
          )
        }
      >
        {(data) => (
          <>
            <div className={cn("overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-opacity", records.isPlaceholderData && "opacity-60")}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-2/50">
                      {columns.map((f, i) => {
                        const active = sort?.field === f.key;
                        const Icon = !active ? ChevronsUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown;
                        return (
                          <th key={f.key} scope="col" aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-0 text-left", i === 0 && "sticky left-0 z-10 bg-surface")}>
                            <button
                              type="button"
                              onClick={() => cycleSort(f.key)}
                              className={cn("inline-flex h-9 items-center gap-1 text-[11.5px] font-medium whitespace-nowrap transition-colors", active ? "text-ink" : "text-muted hover:text-ink")}
                            >
                              {f.label}
                              {f.unit && f.type !== "currency" ? <span className="text-muted">({f.unit})</span> : null}
                              <Icon className={cn("size-3", !active && "opacity-50")} aria-hidden />
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r) => (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        onClick={() => onOpen(r)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onOpen(r);
                          }
                        }}
                        className="group cursor-pointer border-b border-line last:border-b-0 hover:bg-surface-2/60 focus-visible:bg-surface-2/60"
                      >
                        {columns.map((f, i) => (
                          <td key={f.key} className={cn("max-w-[260px] px-3 py-2.5 align-middle", i === 0 ? "sticky left-0 z-10 bg-surface font-medium text-ink group-hover:bg-surface-2" : "text-ink-2")}>
                            {i === 0 ? <span className="block truncate">{formatFieldText(f, r.data[f.key] ?? r.key)}</span> : <FieldValue field={f} value={r.data[f.key]} className="truncate" maxChips={2} />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <Pager offset={offset} total={data.total} count={data.items.length} onChange={setOffset} />
          </>
        )}
      </QueryView>
    </div>
  );
}

function Pager({ offset, total, count, onChange }: { offset: number; total: number; count: number; onChange: (o: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted">
      <span className="tabular">{total <= PAGE && offset === 0 ? `${num(total)} record${total === 1 ? "" : "s"}` : `${offset + 1}–${offset + count} of ${num(total)}`}</span>
      {total > PAGE ? (
        <div className="flex items-center gap-1.5">
          <Button size="xs" icon={<ChevronLeft className="size-3.5" />} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE))}>
            Previous
          </Button>
          <Button size="xs" disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)}>
            Next <ChevronRight className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Record drawer ---------------- */

type FormValue = string | boolean;

function toForm(f: DatasetField, v: unknown): FormValue {
  if (f.type === "boolean") return v === true || v === "true";
  if (v === null || v === undefined) return "";
  if (f.type === "list") return Array.isArray(v) ? v.join(", ") : String(v);
  if (f.type === "date") return String(v).slice(0, 10);
  return String(v);
}

function fromForm(f: DatasetField, v: FormValue): unknown {
  if (f.type === "boolean") return Boolean(v);
  const s = String(v).trim();
  if (!s) return null;
  if (f.type === "number" || f.type === "currency" || f.type === "rating") {
    const n = Number(s.replace(/[,₹\s]/g, ""));
    return Number.isFinite(n) ? n : s;
  }
  if (f.type === "list") return s.split(/\s*[,;]\s*/).filter(Boolean);
  return s;
}

function RecordDrawer({ ds, record, onClose, denied }: { ds: Dataset; record: DatasetRecord | "new" | null; onClose: () => void; denied: string | null }) {
  const open = record !== null;
  const isNew = record === "new";
  const rec = record && record !== "new" ? record : null;
  const [form, setForm] = useState<Record<string, FormValue>>({});
  const [sourceUrl, setSourceUrl] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form whenever a different record (or "new") is opened.
  const openKey = record === null ? null : record === "new" ? "new" : record.id;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  if (openKey !== loadedKey) {
    setLoadedKey(openKey);
    setConfirmDelete(false);
    setSourceUrl(rec?.source_url ?? "");
    setForm(Object.fromEntries(ds.fields.map((f) => [f.key, toForm(f, rec?.data[f.key])])));
  }

  const payload = () => ({ data: Object.fromEntries(ds.fields.map((f) => [f.key, fromForm(f, form[f.key] ?? "")])), source_url: sourceUrl.trim() || null });
  const keyMissing = !String(form[ds.key_field] ?? "").trim();

  const save = useAction(
    () => (rec ? patch<DatasetRecord>(`/datasets/${ds.id}/records/${rec.id}`, payload()) : post<DatasetRecord>(`/datasets/${ds.id}/records`, payload())),
    { success: (r) => (isNew ? `${r.key} added` : `${r.key} saved`), invalidate: [["datasets"]], onSuccess: onClose },
  );
  const remove = useAction(() => del<void>(`/datasets/${ds.id}/records/${rec?.id}`), { success: "Record deleted", invalidate: [["datasets"]], onSuccess: onClose });
  const keyLabel = ds.fields.find((f) => f.key === ds.key_field)?.label ?? ds.key_field;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="w-[520px]"
      title={isNew ? "New record" : (rec?.key ?? "Record")}
      footer={
        <>
          {rec ? (
            confirmDelete ? (
              <span className="mr-auto inline-flex items-center gap-2">
                <span className="text-[12px] text-bad">Delete this record?</span>
                <Button size="xs" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(undefined)}>
                  Delete
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button variant="ghost" className="mr-auto text-bad" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)} disabledReason={denied}>
                Delete
              </Button>
            )
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)} disabledReason={denied || (keyMissing ? `${keyLabel} is required` : null)}>
            {isNew ? "Add record" : "Save"}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!denied && !keyMissing) save.mutate(undefined);
        }}
      >
        {ds.fields.map((f) => (
          <FieldInput key={f.key} field={f} isKey={f.key === ds.key_field} value={form[f.key] ?? ""} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} disabled={!!denied} />
        ))}
        <Field label="Source URL" hint="Where this record came from.">
          <Input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" disabled={!!denied} />
        </Field>
        {rec ? (
          <p className="text-[11.5px] text-muted">
            Updated {ago(rec.updated_at)} · created {ago(rec.created_at)}
            {rec.source_url ? (
              <>
                {" · "}
                <a href={rec.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                  {hostOf(rec.source_url)} <ExternalLink className="size-3" />
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Drawer>
  );
}

function FieldInput({ field: f, isKey, value, onChange, disabled }: { field: DatasetField; isKey: boolean; value: FormValue; onChange: (v: FormValue) => void; disabled: boolean }) {
  const label = (
    <span className="inline-flex items-center gap-1.5">
      {f.label}
      {f.unit ? <span className="font-normal text-muted">({f.unit})</span> : null}
      {isKey ? <span className="rounded bg-accent-soft px-1 py-px text-[10px] font-semibold text-accent">KEY</span> : null}
    </span>
  );
  if (f.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
        <span className="text-xs font-medium text-ink-2">{label}</span>
        <Toggle checked={Boolean(value)} onChange={onChange} label={f.label} disabled={disabled} />
      </div>
    );
  }
  const str = String(value);
  const common = { value: str, disabled, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  switch (f.type) {
    case "number":
    case "currency":
      return (
        <Field label={label}>
          <Input {...common} type="number" step="any" inputMode="decimal" className="tabular" />
        </Field>
      );
    case "rating":
      return (
        <Field label={label} hint="0 to 5">
          <Input {...common} type="number" step="0.1" min={0} max={5} inputMode="decimal" className="tabular" />
        </Field>
      );
    case "date":
      return (
        <Field label={label}>
          <Input {...common} type="date" />
        </Field>
      );
    case "url":
      return (
        <Field label={label}>
          <Input {...common} type="url" placeholder="https://" />
        </Field>
      );
    case "list":
      return (
        <Field label={label} hint="Separate items with commas.">
          <Input {...common} />
        </Field>
      );
    default:
      return (
        <Field label={label}>
          {str.length > 80 ? <Textarea {...common} rows={3} /> : <Input {...common} required={isKey} />}
        </Field>
      );
  }
}

/* ---------------- Import ---------------- */

/** RFC 4180-style CSV: quoted fields, escaped quotes (""), commas and newlines inside quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function coerceCell(f: DatasetField | undefined, raw: string): unknown {
  const s = raw.trim();
  if (!f) return s;
  if (s === "") return null;
  switch (f.type) {
    case "number":
    case "currency":
    case "rating": {
      const n = Number(s.replace(/[,₹%\s]/g, ""));
      return Number.isFinite(n) ? n : s;
    }
    case "boolean":
      return /^(true|yes|y|1)$/i.test(s);
    case "list":
      return s.split(/[;|]/.test(s) ? /\s*[;|]\s*/ : /\s*,\s*/).filter(Boolean);
    default:
      return s;
  }
}

interface Parsed {
  rows: Record<string, unknown>[];
  matched: string[];
  ignored: string[];
  error: string | null;
}

function parseImport(text: string, ds: Dataset): Parsed {
  const t = text.trim();
  if (!t) return { rows: [], matched: [], ignored: [], error: null };
  const byHeader = new Map<string, DatasetField>();
  for (const f of ds.fields) {
    byHeader.set(normHeader(f.key), f);
    byHeader.set(normHeader(f.label), f);
  }
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const json = JSON.parse(t) as unknown;
      const arr = Array.isArray(json) ? json : json && typeof json === "object" ? ((json as Record<string, unknown>).items ?? (json as Record<string, unknown>).rows ?? (json as Record<string, unknown>).records ?? [json]) : null;
      if (!Array.isArray(arr)) return { rows: [], matched: [], ignored: [], error: "JSON must be an array of objects" };
      const keys = new Set<string>();
      const rows = arr
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
        .map((r) => {
          // Rows may come straight from the API ({ data: {...} }) or be flat objects.
          const flat = r.data && typeof r.data === "object" && !Array.isArray(r.data) ? { ...(r.data as Record<string, unknown>), source_url: r.source_url } : r;
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(flat)) {
            keys.add(k);
            if (k === "source_url") {
              if (v) out.source_url = v;
              continue;
            }
            const f = byHeader.get(normHeader(k));
            if (f) out[f.key] = typeof v === "string" ? coerceCell(f, v) : v;
          }
          return out;
        });
      const matched = [...keys].filter((k) => byHeader.has(normHeader(k)));
      const ignored = [...keys].filter((k) => !byHeader.has(normHeader(k)) && k !== "source_url" && k !== "data");
      return { rows, matched, ignored, error: rows.length ? null : "No objects found in the JSON" };
    } catch (e) {
      return { rows: [], matched: [], ignored: [], error: `Invalid JSON: ${(e as Error).message}` };
    }
  }
  const grid = parseCsv(t);
  if (grid.length < 2) return { rows: [], matched: [], ignored: [], error: "CSV needs a header row and at least one data row" };
  const headers = grid[0].map((h) => h.trim());
  const cols = headers.map((h) => (normHeader(h) === "sourceurl" ? "source_url" : byHeader.get(normHeader(h))));
  const rows = grid.slice(1).map((cells) => {
    const out: Record<string, unknown> = {};
    cols.forEach((f, i) => {
      const raw = cells[i] ?? "";
      if (f === "source_url") {
        if (raw.trim()) out.source_url = raw.trim();
      } else if (f) out[f.key] = coerceCell(f, raw);
    });
    return out;
  });
  return { rows, matched: headers.filter((_, i) => cols[i]), ignored: headers.filter((h, i) => !cols[i] && h), error: null };
}

function ImportDialog({ ds, open, onClose }: { ds: Dataset; open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseImport(text, ds), [text, ds]);
  const keyField = ds.fields.find((f) => f.key === ds.key_field);
  const withKey = parsed.rows.filter((r) => r[ds.key_field] !== undefined && r[ds.key_field] !== null && String(r[ds.key_field]).trim() !== "").length;
  const preview = ds.fields.slice(0, 4);

  const run = useAction((rows: Record<string, unknown>[]) => post<{ created: number; updated: number; skipped: number }>(`/datasets/${ds.id}/import`, { rows }), {
    success: (r) => `Imported: ${r.created} new, ${r.updated} updated`,
    invalidate: [["datasets"]],
    onSuccess: (r) => setResult(r),
  });

  const close = () => {
    onClose();
    setTimeout(() => {
      setText("");
      setResult(null);
    }, 150);
  };

  const sample = useMemo(() => {
    const cols = ds.fields.slice(0, 4);
    return `${cols.map((f) => f.key).join(",")}\n${cols.map((f) => (f.type === "number" || f.type === "currency" || f.type === "rating" ? "0" : f.type === "list" ? '"a; b"' : f.type === "boolean" ? "true" : f.type === "date" ? "2026-12-01" : `"${f.label}"`)).join(",")}`;
  }, [ds.fields]);

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={`Import into ${ds.name}`}
      description={`Paste a JSON array or CSV (first row = headers). Records with the same ${keyField?.label ?? ds.key_field} are updated, new ones are added.`}
      footer={
        result ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" loading={run.isPending} disabledReason={!parsed.rows.length ? "Paste some rows first" : parsed.error} onClick={() => run.mutate(parsed.rows)}>
              Import {parsed.rows.length ? `${num(parsed.rows.length)} row${parsed.rows.length === 1 ? "" : "s"}` : ""}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="py-4 text-center">
          <div className="mx-auto grid max-w-sm grid-cols-3 gap-3">
            {(
              [
                ["New", result.created, "text-ok"],
                ["Updated", result.updated, "text-ink"],
                ["Skipped", result.skipped, result.skipped ? "text-warn" : "text-muted"],
              ] as const
            ).map(([label, n, tone]) => (
              <div key={label} className="rounded-xl border border-line px-3 py-3">
                <p className={cn("text-[24px] leading-none font-semibold tabular", tone)}>{n}</p>
                <p className="mt-1.5 text-[12px] text-muted">{label}</p>
              </div>
            ))}
          </div>
          {result.skipped ? <p className="mt-4 text-[12.5px] text-ink-2">Skipped rows had no {keyField?.label ?? ds.key_field} or weren&apos;t objects.</p> : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink-2">Data</span>
            <span className="flex items-center gap-2">
              <Button size="xs" variant="ghost" onClick={() => setText(sample)}>
                Insert example
              </Button>
              <Button size="xs" icon={<FileUp className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                Choose file
              </Button>
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void file.text().then(setText);
                e.target.value = "";
              }}
            />
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} className="font-mono text-[12px]" placeholder={`[{"${ds.key_field}": "…"}]\n\nor\n\n${ds.fields.map((f) => f.key).slice(0, 4).join(",")}`} aria-label="Rows to import" />

          {parsed.error ? (
            <Banner tone="bad" title="Can't read this">
              {parsed.error}
            </Banner>
          ) : parsed.rows.length ? (
            <div className="space-y-2">
              <p className="text-[12.5px] text-ink-2">
                <span className="font-semibold text-ink tabular">{num(parsed.rows.length)}</span> row{parsed.rows.length === 1 ? "" : "s"} ready
                {withKey < parsed.rows.length ? <span className="text-warn"> · {parsed.rows.length - withKey} without {keyField?.label ?? ds.key_field} will be skipped</span> : null}
              </p>
              {parsed.ignored.length ? <p className="text-[12px] text-muted">Ignored columns: {parsed.ignored.join(", ")}</p> : null}
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-line bg-surface-2/60">
                      {preview.map((f) => (
                        <th key={f.key} className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-muted">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 3).map((r, i) => (
                      <tr key={i} className="border-b border-line last:border-b-0">
                        {preview.map((f) => (
                          <td key={f.key} className="max-w-[180px] truncate px-2.5 py-1.5 text-ink-2">
                            {formatFieldText(f, r[f.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-muted">Headers can be field keys or labels: {ds.fields.map((f) => f.key).join(", ")}.</p>
          )}
        </div>
      )}
    </Dialog>
  );
}

/* ---------------- Schema ---------------- */

function SchemaTab({ ds, denied }: { ds: Dataset; denied: string | null }) {
  const [drafts, setDrafts] = useState<FieldDraft[]>(() => toDrafts(ds.fields));
  const [keyField, setKeyField] = useState(ds.key_field);
  const [description, setDescription] = useState(ds.description);
  const original = JSON.stringify([ds.fields, ds.key_field, ds.description]);
  const current = JSON.stringify([fromDrafts(drafts), keyField, description]);
  const dirty = original !== current;
  const error = schemaError(drafts, keyField);

  const save = useAction(() => patch<Dataset>(`/datasets/${ds.id}`, { fields: fromDrafts(drafts), key_field: keyField, description }), {
    success: "Schema saved",
    invalidate: [["datasets"]],
    onSuccess: (d) => {
      setDrafts(toDrafts(d.fields));
      setKeyField(d.key_field);
      setDescription(d.description);
    },
  });

  return (
    <Card className="p-5">
      <div className="space-y-5">
        <Field label="Description" hint="Shown to your team and returned by the public API.">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!!denied} />
        </Field>
        <div>
          <p className="mb-2 text-xs font-medium text-ink-2">Fields</p>
          <SchemaEditor value={drafts} onChange={setDrafts} disabled={!!denied} />
        </div>
        <Field label="Key field" hint="Changing it re-keys existing records." className="max-w-xs">
          <Select value={keyField} onChange={(e) => setKeyField(e.target.value)} disabled={!!denied}>
            {drafts
              .filter((f) => f.key)
              .map((f) => (
                <option key={f._id} value={f.key}>
                  {f.label || f.key}
                </option>
              ))}
          </Select>
        </Field>
        <p className="text-[12px] text-muted">Fields marked Compare appear in the assistant&apos;s comparison tables. “Best is” decides which value gets the trophy.</p>
        {dirty && error ? (
          <Banner tone="bad" title="Fix the schema to save">
            {error}
          </Banner>
        ) : null}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button
            variant="ghost"
            disabled={!dirty}
            onClick={() => {
              setDrafts(toDrafts(ds.fields));
              setKeyField(ds.key_field);
              setDescription(ds.description);
            }}
          >
            Discard
          </Button>
          <Button variant="primary" loading={save.isPending} disabledReason={denied || (!dirty ? "No changes" : error)} onClick={() => save.mutate(undefined)}>
            Save schema
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Public API ---------------- */

function ApiTab({ ds, denied }: { ds: Dataset; denied: string | null }) {
  const [origin, setOrigin] = useState("https://your-layerflow-host");
  useEffect(() => setOrigin(window.location.origin), []);
  const togglePublic = useAction((pub: boolean) => patch<Dataset>(`/datasets/${ds.id}`, { public: pub }), {
    success: (d) => (d.public ? `${d.name} is now public` : `${d.name} is now private`),
    invalidate: [["datasets"]],
  });
  const firstText = ds.fields.find((f) => f.key === ds.key_field);
  const url = `${origin}/api/public/v1/datasets/${ds.slug}/records?q=&limit=20`;
  const curl = `curl "${url}" \\\n  -H "Authorization: Bearer lf_pk_…"`;
  const fetchSnippet = `const res = await fetch(\n  "${url}",\n  { headers: { Authorization: "Bearer lf_pk_…" } },\n);\nconst { dataset, items, total } = await res.json();\n// items[0].data.${firstText?.key ?? "name"}`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <CodeBlock title="curl" code={curl} />
        <CodeBlock title="JavaScript · fetch" code={fetchSnippet} />
        <p className="text-[12.5px] text-ink-2">
          Add <code className="rounded bg-surface-2 px-1 font-mono text-[11.5px]">q</code> to search, <code className="rounded bg-surface-2 px-1 font-mono text-[11.5px]">sort=field:desc</code> to order and{" "}
          <code className="rounded bg-surface-2 px-1 font-mono text-[11.5px]">offset</code> to page. One record:{" "}
          <code className="rounded bg-surface-2 px-1 font-mono text-[11.5px]">/records/{"{key}"}</code>. Responses are cached for 60 seconds.
        </p>
      </div>
      <div className="space-y-4">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">Public access</p>
              <p className="mt-0.5 text-[12px] text-muted">{ds.public ? "Readable with any API key that has datasets:read." : "The public API returns 404 until you turn this on."}</p>
            </div>
            <Toggle checked={ds.public} onChange={(v) => togglePublic.mutate(v)} label="Public dataset" disabled={!!denied || togglePublic.isPending} title={denied ?? undefined} />
          </div>
        </Card>
        {!ds.public ? (
          <Banner tone="warn" title="This dataset is private">
            Turn on public access before calling these endpoints from a website.
          </Banner>
        ) : null}
        <Card className="p-4">
          <p className="text-[13px] font-semibold text-ink">API key</p>
          <p className="mt-0.5 text-[12px] text-muted">
            Replace <code className="font-mono">lf_pk_…</code> with a key that has the <span className="font-medium text-ink-2">datasets:read</span> scope.
          </p>
          <Link href="/developers" className="mt-2 inline-block text-[12.5px] font-medium text-accent hover:underline">
            Manage API keys →
          </Link>
        </Card>
      </div>
    </div>
  );
}

