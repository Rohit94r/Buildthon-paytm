"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, Globe, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner, Button, Dialog, Field, Input, PageHeader, QueryView, Select, Skeleton, Textarea, Toggle } from "@/components/ui";
import { Empty, usePermissions } from "@/components/platform/kit";
import { fromDrafts, newDraft, schemaError, SchemaEditor, toKey, type FieldDraft } from "@/components/platform/dataset-schema";
import { get, post } from "@/lib/api";
import { ago, num } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Dataset, DatasetWrite } from "@/lib/platform-types";

export default function DatasetsPage() {
  const { can, reason } = usePermissions();
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["datasets"], queryFn: () => get<{ items: Dataset[] }>("/datasets"), select: (d) => d.items });
  const denied = reason("data.edit");

  const newButton = (
    <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)} disabledReason={denied}>
      New dataset
    </Button>
  );

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Datasets" subtitle="Structured records your agents scrape and keep fresh. They power comparisons, the assistant and your public API." actions={newButton} />

      <QueryView
        query={query}
        skeleton={
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[168px] rounded-xl" />
            ))}
          </div>
        }
        isEmpty={(d) => d.length === 0}
        empty={<Empty icon={<Database />} title="No datasets yet" body="Create one by hand, or let a dataset builder agent fill it from the web." action={can("data.edit") ? newButton : undefined} />}
      >
        {(items) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((d) => (
              <DatasetCard key={d.id} d={d} />
            ))}
          </div>
        )}
      </QueryView>

      <NewDatasetDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function DatasetCard({ d }: { d: Dataset }) {
  return (
    <Link href={`/datasets/${d.id}`} className="group flex flex-col rounded-xl border border-line bg-surface p-5 shadow-sm transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Database className="size-4" aria-hidden />
        </span>
        {d.public ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-[3px] text-[11px] font-medium text-ok">
            <Globe className="size-3" aria-hidden /> Public
          </span>
        ) : (
          <span className="rounded-full bg-surface-2 px-2 py-[3px] text-[11px] font-medium text-muted">Private</span>
        )}
      </div>
      <p className="mt-4 text-[15px] font-semibold text-ink group-hover:text-accent">{d.name}</p>
      <p className="mt-1 line-clamp-2 min-h-[2.6em] text-[12.5px] leading-snug text-ink-2">{d.description || <span className="text-muted">No description</span>}</p>
      <div className="mt-4 flex items-center gap-3 border-t border-line pt-3 text-[12px] text-muted">
        <span>
          <span className="font-semibold text-ink tabular">{num(d.record_count)}</span> records
        </span>
        <span>
          <span className="font-semibold text-ink tabular">{d.fields.length}</span> fields
        </span>
        <span className="ml-auto">{ago(d.updated_at)}</span>
      </div>
    </Link>
  );
}

const STARTER = (): FieldDraft[] => [newDraft({ key: "name", label: "Name", type: "text" })];

function NewDatasetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>(STARTER);
  const [keyField, setKeyField] = useState("name");
  const [isPublic, setIsPublic] = useState(false);
  const [touched, setTouched] = useState(false);

  const reset = () => {
    setName("");
    setSlug("");
    setDescription("");
    setFields(STARTER());
    setKeyField("name");
    setIsPublic(false);
    setTouched(false);
  };

  const keys = fields.map((f) => f.key).filter(Boolean);
  const effectiveKey = keys.includes(keyField) ? keyField : (keys[0] ?? "");
  const error = !name.trim() ? "Give the dataset a name" : schemaError(fields, effectiveKey);

  const create = useAction((body: DatasetWrite) => post<Dataset>("/datasets", body), {
    success: (d) => `${d.name} created`,
    invalidate: [["datasets"]],
    onSuccess: (d) => {
      onClose();
      reset();
      router.push(`/datasets/${d.id}`);
    },
  });

  const submit = () => {
    setTouched(true);
    if (error) return;
    create.mutate({ name: name.trim(), slug: slug.trim() || undefined, description: description.trim(), fields: fromDrafts(fields), key_field: effectiveKey, public: isPublic });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="New dataset"
      description="Define the fields once. Agents, imports and the API all write records in this shape."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            Create dataset
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering colleges" />
          </Field>
          <Field label="Slug" hint="Used in the public API URL.">
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={toKey(name).replace(/_/g, "-") || "engineering-colleges"} className="font-mono text-[12px]" />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's in it, where it comes from, how fresh it is." />
        </Field>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-2">Fields</p>
          <SchemaEditor value={fields} onChange={setFields} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Key field" hint="Uniquely identifies a record; imports update records with the same key.">
            <Select value={effectiveKey} onChange={(e) => setKeyField(e.target.value)}>
              {fields
                .filter((f) => f.key)
                .map((f) => (
                  <option key={f._id} value={f.key}>
                    {f.label || f.key}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
            <div>
              <p className="text-[13px] font-medium text-ink">Public</p>
              <p className="text-xs text-muted">Readable with an API key on your website.</p>
            </div>
            <Toggle checked={isPublic} onChange={setIsPublic} label="Public dataset" />
          </div>
        </div>

        {touched && error ? (
          <Banner tone="bad" title="Can't create yet">
            {error}
          </Banner>
        ) : null}
      </div>
    </Dialog>
  );
}
