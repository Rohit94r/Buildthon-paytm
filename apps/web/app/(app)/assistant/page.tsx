"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Check, Database, ListChecks, MessagesSquare, RotateCcw, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, cn, PageHeader, Select, Skeleton } from "@/components/ui";
import { Empty, Markdown, SearchInput } from "@/components/platform/kit";
import { ComparisonTable } from "@/components/platform/comparison-table";
import { errorMessage, get, post } from "@/lib/api";
import { ms } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Agent, ChatMessage, ChatRequest, ChatResponse, Dataset, DatasetRecord, Paged } from "@/lib/platform-types";

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  compare?: string[];
  response?: ChatResponse;
  error?: string;
  retry?: { message: string; compare: string[] };
}

type Source = { type: "agent"; agent: Agent; datasetId: string | null } | { type: "dataset"; dataset: Dataset; datasetId: string };

const turnId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function suggestedPrompts(source: Source | null, ds: Dataset | undefined, records: DatasetRecord[]): string[] {
  if (source?.type === "agent") {
    const q = source.agent.config.suggested_questions;
    if (Array.isArray(q) && q.length) return q.map(String).slice(0, 4);
  }
  if (!ds) return [];
  const slug = ds.slug.toLowerCase();
  if (slug.includes("college")) return ["Compare IIT Bombay vs BITS Pilani on fees and placements", "Cheapest colleges with placement rate above 90%", "Best value private college"];
  if (slug.includes("hackathon")) return ["Which online AI hackathons close this month? Compare prizes", "Hackathons in Bengaluru", "Biggest prize pools open to students"];
  if (slug.includes("ipo")) return ["Which IPOs open this week?", "Compare subscription and GMP of the open IPOs", "Largest issues by size"];
  if (slug.includes("price")) return ["Which retailer is cheapest for each product?", "Biggest discounts right now", "Compare prices across retailers"];
  const cmp = ds.fields.filter((f) => f.compare);
  const names = records.slice(0, 2).map((r) => r.key);
  const out: string[] = [];
  if (names.length === 2 && cmp.length) out.push(`Compare ${names[0]} vs ${names[1]} on ${cmp.slice(0, 2).map((f) => f.label.toLowerCase()).join(" and ")}`);
  const ranked = cmp.find((f) => f.higher_is_better !== undefined);
  if (ranked) out.push(`Which has the ${ranked.higher_is_better ? "highest" : "lowest"} ${ranked.label.toLowerCase()}?`);
  if (cmp[0]) out.push(`Show the top 5 by ${cmp[0].label.toLowerCase()}`);
  if (!out.length) out.push(`What's in ${ds.name}?`);
  return out;
}

export default function AssistantPage() {
  const agentsQ = useQuery({ queryKey: ["agents"], queryFn: () => get<{ items: Agent[] }>("/agents"), select: (d) => d.items });
  const datasetsQ = useQuery({ queryKey: ["datasets"], queryFn: () => get<{ items: Dataset[] }>("/datasets"), select: (d) => d.items });
  const assistants = useMemo(() => (agentsQ.data ?? []).filter((a) => a.kind === "comparison_assistant"), [agentsQ.data]);
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);

  const [picked, setPicked] = useState<string>("");
  const defaultValue = assistants[0] ? `agent:${assistants[0].id}` : datasets[0] ? `dataset:${datasets[0].id}` : "";
  const value = picked || defaultValue;

  const source: Source | null = useMemo(() => {
    const [type, id] = value.split(":");
    if (type === "agent") {
      const agent = assistants.find((a) => a.id === id);
      if (!agent) return null;
      const dsRef = typeof agent.config.dataset === "string" ? agent.config.dataset : null;
      const ds = datasets.find((d) => d.id === dsRef || d.slug === dsRef);
      return { type: "agent", agent, datasetId: ds?.id ?? dsRef };
    }
    if (type === "dataset") {
      const dataset = datasets.find((d) => d.id === id);
      return dataset ? { type: "dataset", dataset, datasetId: dataset.id } : null;
    }
    return null;
  }, [value, assistants, datasets]);
  const dataset = source ? datasets.find((d) => d.id === source.datasetId) : undefined;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const reset = () => {
    setTurns([]);
    setCompare([]);
  };

  const loading = agentsQ.isPending || datasetsQ.isPending;
  const nothing = !loading && !assistants.length && !datasets.length;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Assistant"
        subtitle="Ask questions about your data in plain language. Answers come with a side-by-side comparison."
        actions={
          <>
            {assistants.length || datasets.length ? (
              <div className="w-[240px] max-w-full">
              <Select
                aria-label="Assistant or dataset"
                value={value}
                onChange={(e) => {
                  setPicked(e.target.value);
                  reset();
                }}
              >
                {assistants.length ? (
                  <optgroup label="Assistants">
                    {assistants.map((a) => (
                      <option key={a.id} value={`agent:${a.id}`}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {datasets.length ? (
                  <optgroup label="Datasets">
                    {datasets.map((d) => (
                      <option key={d.id} value={`dataset:${d.id}`}>
                        {d.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </Select>
              </div>
            ) : null}
            <Button icon={<RotateCcw className="size-3.5" />} onClick={reset} disabledReason={!turns.length && !compare.length ? "Nothing to reset yet" : null}>
              Reset
            </Button>
          </>
        }
      />

      {loading ? (
        <Skeleton className="h-[560px] rounded-xl" />
      ) : nothing ? (
        <Empty
          icon={<Database />}
          title="Nothing to ask yet"
          body="The assistant answers from a dataset. Create one, or activate a comparison assistant from the catalogue."
          action={
            <Link href="/datasets" className="text-[13px] font-medium text-accent hover:underline">
              Go to datasets →
            </Link>
          }
        />
      ) : source ? (
        <Chat key={value} source={source} dataset={dataset} turns={turns} setTurns={setTurns} compare={compare} setCompare={setCompare} />
      ) : (
        <Empty title="Pick an assistant or dataset" body="Choose what to ask about from the menu above." />
      )}
    </div>
  );
}

/* ====================================================================== */

function Chat({
  source,
  dataset,
  turns,
  setTurns,
  compare,
  setCompare,
}: {
  source: Source;
  dataset: Dataset | undefined;
  turns: Turn[];
  setTurns: (fn: (t: Turn[]) => Turn[]) => void;
  compare: string[];
  setCompare: (v: string[]) => void;
}) {
  const dsId = source.datasetId;
  const recordsQ = useQuery({
    queryKey: ["datasets", dsId, "records", { limit: 200 }],
    queryFn: () => get<Paged<DatasetRecord>>(`/datasets/${dsId}/records`, { limit: 200 }),
    enabled: !!dsId,
    select: (d) => d.items,
  });
  const records = useMemo(() => recordsQ.data ?? [], [recordsQ.data]);
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const name = source.type === "agent" ? source.agent.name : source.dataset.name;

  const chat = useAction((req: ChatRequest) => post<ChatResponse>("/assistant/chat", req), {
    silent: true,
    onSuccess: (r) => setTurns((t) => [...t, { id: turnId(), role: "assistant", content: r.answer, response: r }]),
    onError: (e, req) => setTurns((t) => [...t, { id: turnId(), role: "assistant", content: "", error: errorMessage(e), retry: { message: req.message, compare: req.compare_keys ?? [] } }]),
  });

  const send = (text: string, keys: string[] = compare) => {
    const message = text.trim();
    if (!message || chat.isPending) return;
    const history: ChatMessage[] = turns
      .filter((t) => !t.error)
      .map((t) => ({ role: t.role, content: t.content }))
      .slice(-8);
    setTurns((t) => [...t, { id: turnId(), role: "user", content: message, compare: keys.length ? keys : undefined }]);
    setInput("");
    const req: ChatRequest = { message, history, ...(keys.length ? { compare_keys: keys } : {}) };
    if (source.type === "agent") req.assistant_id = source.agent.id;
    else req.dataset = source.dataset.id;
    chat.mutate(req);
  };

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns.length, chat.isPending]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const prompts = suggestedPrompts(source, dataset, records);

  return (
    <div className="flex h-[calc(100dvh-210px)] min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <MessagesSquare className="size-5" aria-hidden />
            </span>
            <p className="text-[17px] font-semibold tracking-tight text-ink">Ask {name}</p>
            <p className="mt-1 max-w-md text-[13px] text-ink-2">
              {dataset ? `Answers come from ${dataset.name} (${dataset.record_count} records).` : "Answers come from the assistant's dataset."} Try one of these:
            </p>
            <div className="mt-5 flex max-w-2xl flex-wrap justify-center gap-2">
              {prompts.map((p) => (
                <button key={p} type="button" onClick={() => send(p)} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] text-ink-2 shadow-sm transition-colors hover:border-accent hover:text-accent">
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[860px] space-y-6">
            {turns.map((t) =>
              t.role === "user" ? (
                <UserBubble key={t.id} turn={t} />
              ) : (
                <AssistantTurn key={t.id} turn={t} onAsk={(q) => send(q)} onRetry={(r) => send(r.message, r.compare)} busy={chat.isPending} />
              ),
            )}
            {chat.isPending ? <Thinking /> : null}
          </div>
        )}
      </div>

      <div className="border-t border-line bg-surface px-3 py-3 sm:px-5">
        <div className="mx-auto max-w-[860px]">
          <ComparePicker records={records} loading={recordsQ.isPending && !!dsId} value={compare} onChange={setCompare} />
          <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-surface px-3 py-2 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={compare.length ? `Ask about ${compare.length} selected record${compare.length === 1 ? "" : "s"}…` : `Ask ${name}…`}
              aria-label="Message"
              className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[14px] leading-6 text-ink placeholder:text-muted focus:outline-none"
            />
            <button
              type="button"
              onClick={() => send(input)}
              disabled={!input.trim() || chat.isPending}
              aria-label="Send"
              title={chat.isPending ? "Waiting for the answer" : !input.trim() ? "Type a question" : "Send (Enter)"}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-solid text-accent-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
          <p className="mt-1.5 hidden text-[11px] text-muted sm:block">Enter to send · Shift+Enter for a new line</p>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ turn }: { turn: Turn }) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[14px] leading-relaxed whitespace-pre-wrap text-accent-ink sm:max-w-[70%]">{turn.content}</div>
      {turn.compare?.length ? <p className="mt-1 text-[11px] text-muted">Comparing {turn.compare.join(", ")}</p> : null}
    </div>
  );
}

function AssistantTurn({ turn, onAsk, onRetry, busy }: { turn: Turn; onAsk: (q: string) => void; onRetry: (r: { message: string; compare: string[] }) => void; busy: boolean }) {
  if (turn.error) {
    return (
      <div className="flex gap-3">
        <BotGlyph />
        <div className="rounded-xl border border-bad/30 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">
          <p>{turn.error}</p>
          {turn.retry ? (
            <button type="button" disabled={busy} onClick={() => onRetry(turn.retry!)} className="mt-1.5 text-[12px] font-medium underline underline-offset-2 disabled:opacity-50">
              Try again
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  const r = turn.response;
  return (
    <div className="flex gap-3">
      <BotGlyph />
      <div className="min-w-0 flex-1 space-y-3">
        <Markdown text={turn.content} />
        {r?.table && r.table.rows.length ? <ComparisonTable table={r.table} /> : null}
        {r?.records.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-muted">Records used</span>
            {r.records.map((rec) => (
              <span key={rec.id} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-ink-2">
                <Database className="size-3 text-muted" aria-hidden />
                {rec.key}
              </span>
            ))}
          </div>
        ) : null}
        {r?.suggestions.length ? (
          <div className="flex flex-wrap gap-1.5">
            {r.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => onAsk(s)}
                className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        {r ? (
          <p className="text-[11px] text-muted tabular">
            {r.model} · {ms(r.latency_ms)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function BotGlyph() {
  return (
    <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden>
      <Sparkles className="size-3.5" />
    </span>
  );
}

function Thinking() {
  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <BotGlyph />
      <div className="flex-1 space-y-2 pt-1">
        <p className="animate-pulse text-[13px] font-medium text-muted">Thinking…</p>
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

/* ---------------- Record multi-select ---------------- */

function ComparePicker({ records, loading, value, onChange }: { records: DatasetRecord[]; loading: boolean; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? records.filter((r) => r.key.toLowerCase().includes(s)) : records).slice(0, 200);
  }, [records, q]);
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);

  return (
    <div ref={box} className="relative mb-2 flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!records.length && !loading}
        title={!records.length && !loading ? "This dataset has no records" : "Pick records to compare side by side"}
        aria-expanded={open}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          open || value.length ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
        )}
      >
        <ListChecks className="size-3.5" aria-hidden />
        {value.length ? `Comparing ${value.length}` : "Compare records"}
      </button>
      {value.map((k) => (
        <span key={k} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface-2 pr-1 pl-2.5 text-[12px] text-ink">
          {k}
          <button type="button" onClick={() => toggle(k)} aria-label={`Remove ${k}`} className="rounded-full p-0.5 text-muted hover:bg-surface-3 hover:text-ink">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {value.length ? (
        <button type="button" onClick={() => onChange([])} className="text-[11.5px] text-muted hover:text-ink">
          Clear
        </button>
      ) : null}

      {open ? (
        <div className="animate-in absolute bottom-full left-0 z-30 mb-2 w-[min(340px,calc(100vw-48px))] rounded-xl border border-line bg-surface p-2 shadow-lg">
          <SearchInput value={q} onChange={setQ} placeholder="Search records…" />
          <ul className="mt-2 max-h-64 overflow-y-auto" role="listbox" aria-multiselectable="true">
            {loading ? (
              <li className="space-y-1.5 p-2">
                <Skeleton className="h-6" />
                <Skeleton className="h-6" />
              </li>
            ) : filtered.length ? (
              filtered.map((r) => {
                const on = value.includes(r.key);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(r.key)}
                      className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2", on ? "text-ink" : "text-ink-2")}
                    >
                      <span className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent-solid text-accent-ink" : "border-line-strong")}>{on ? <Check className="size-3" /> : null}</span>
                      <span className="truncate">{r.key}</span>
                    </button>
                  </li>
                );
              })
            ) : (
              <li className="px-2 py-3 text-center text-[12px] text-muted">No records match</li>
            )}
          </ul>
          <p className="border-t border-line px-2 pt-2 text-[11px] text-muted">Selected records are always compared in the next answers.</p>
        </div>
      ) : null}
    </div>
  );
}
