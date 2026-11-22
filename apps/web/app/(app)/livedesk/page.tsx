"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BookOpenCheck,
  BriefcaseBusiness,
  ExternalLink,
  Globe2,
  GraduationCap,
  MapPin,
  Newspaper,
  ScanSearch,
  ShoppingBag,
  Sparkles,
  Zap,
} from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Button, cn, PageHeader, Skeleton } from "@/components/ui";
import { Markdown } from "@/components/platform/kit";
import { errorMessage, get, post } from "@/lib/api";
import { ms } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type {
  LiveDeskCollection,
  LiveDeskEngine,
  LiveDeskRequest,
  LiveDeskResponse,
  LiveDeskStatus,
} from "@/lib/platform-types";

const ENGINE_ICONS: Record<LiveDeskEngine, typeof Globe2> = {
  google: Globe2,
  google_news: Newspaper,
  google_jobs: BriefcaseBusiness,
  google_shopping: ShoppingBag,
  google_maps: MapPin,
  google_scholar: GraduationCap,
};

const PRESETS = [
  "AI agent startup funding in India this month",
  "What changed in AI agent pricing this week?",
  "Agentic AI hackathons in India 2026",
  "SerpApi vs You.com for live research agents",
];

export default function LiveDeskPage() {
  const statusQ = useQuery({ queryKey: ["livedesk", "status"], queryFn: () => get<LiveDeskStatus>("/livedesk/status") });
  const status = statusQ.data;
  const [query, setQuery] = useState(PRESETS[0]);
  const [engines, setEngines] = useState<LiveDeskEngine[]>(["google", "google_news"]);
  const [location, setLocation] = useState("India");
  const [count, setCount] = useState(5);
  const [result, setResult] = useState<LiveDeskResponse | null>(null);
  const [error, setError] = useState("");

  const run = useAction((req: LiveDeskRequest) => post<LiveDeskResponse>("/livedesk/research", req), {
    silent: true,
    onSuccess: (r) => {
      setResult(r);
      setError("");
    },
    onError: (e) => {
      setError(errorMessage(e));
      setResult(null);
    },
  });

  const submit = () => {
    const q = query.trim();
    if (q.length < 2 || run.isPending) return;
    run.mutate({ query: q, engines, location: location.trim() || undefined, count });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const toggleEngine = (key: LiveDeskEngine) =>
    setEngines((current) => (current.includes(key) ? current.filter((e) => e !== key) : [...current, key]));

  const totalHits = useMemo(() => (result?.collections ?? []).reduce((n, c) => n + c.hits.length, 0), [result]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader
        title="LiveDesk"
        subtitle="One question. Two sponsor APIs. Every answer backed by sources you can open."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
                status?.mode === "live" ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface-2 text-ink-2",
              )}
            >
              <Zap className="size-3" aria-hidden />
              {statusQ.isPending ? "Checking sponsor keys…" : status?.mode === "live" ? "Sponsor keys connected" : "Demo mode · sample data"}
            </span>
          </div>
        }
      />

      <section className="rounded-xl border border-line bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <ScanSearch className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <label htmlFor="livedesk-query" className="text-[12px] font-semibold text-ink">
                Research question
              </label>
              <textarea
                id="livedesk-query"
                rows={2}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Ask anything that needs fresh web evidence…"
                className="mt-1 w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2 text-[14px] leading-6 text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setQuery(p)}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
              >
                {p}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">SerpApi engines</p>
              <div className="flex flex-wrap gap-1.5">
                {(status?.engines ?? [
                  { key: "google", label: "Web" },
                  { key: "google_news", label: "News" },
                  { key: "google_jobs", label: "Jobs" },
                  { key: "google_shopping", label: "Shopping" },
                  { key: "google_maps", label: "Maps" },
                  { key: "google_scholar", label: "Scholar" },
                ]).map((e) => {
                  const Icon = ENGINE_ICONS[e.key];
                  const on = engines.includes(e.key);
                  return (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => toggleEngine(e.key)}
                      aria-pressed={on}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                        on ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                      {e.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Location</span>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="India"
                  className="h-9 w-[140px] rounded-lg border border-line-strong bg-surface px-2.5 text-[12.5px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Results</span>
                <select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="h-9 rounded-lg border border-line-strong bg-surface px-2.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
                >
                  {[3, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>{n} per engine</option>
                  ))}
                </select>
              </label>
              <Button variant="primary" icon={<Sparkles className="size-3.5" />} loading={run.isPending} disabledReason={query.trim().length < 2 ? "Type a question" : !engines.length ? "Pick an engine" : null} onClick={submit}>
                Run research
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted">⌘/Ctrl + Enter to run · sponsor keys are read server-side from the environment.</p>
        </div>
      </section>

      {error ? <div className="rounded-lg border border-bad/30 bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">{error}</div> : null}

      {run.isPending && !result ? (
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : null}

      {result ? (
        <div className="space-y-5">
          <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2/50 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold text-accent">
                  <BookOpenCheck className="size-3" aria-hidden />
                  You.com cited answer
                </span>
                {result.answer.degraded ? <Badge tone="warn">sample answer</Badge> : <Badge tone="good">live answer</Badge>}
                <span className="text-[11.5px] text-muted">{ms(result.latency_ms)} · {result.answer.citations.length} citations</span>
              </div>
              <span className="font-mono text-[11px] text-muted">{result.query}</span>
            </div>
            <div className="px-4 py-4 sm:px-5">
              <Markdown text={result.answer.answer} />
              {result.sources.length ? (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Sources</p>
                  <ol className="grid gap-1.5 sm:grid-cols-2">
                    {result.sources.map((s, i) => (
                      <li key={`${s.source}-${i}`} className="flex min-w-0 items-start gap-2 text-[12px] leading-5">
                        <span className="mt-0.5 inline-flex size-[18px] shrink-0 items-center justify-center rounded bg-surface-2 font-mono text-[10px] text-muted">[{s.number ?? i + 1}]</span>
                        <a href={s.source} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 text-ink-2 hover:text-accent hover:underline">
                          <span className="truncate">{s.title || s.source}</span>
                          <ExternalLink className="size-3 shrink-0" aria-hidden />
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          </section>

          <div>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[14px] font-semibold tracking-tight text-ink">SerpApi structured collection</h2>
              <span className="text-[11.5px] text-muted">
                {result.collections.length} engine{result.collections.length === 1 ? "" : "s"} · {totalHits} results
              </span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {result.collections.map((c) => (
                <CollectionCard key={c.engine} collection={c} />
              ))}
            </div>
          </div>

          <p className="text-center text-[11px] text-muted">
            Powered by <span className="font-medium text-ink-2">SerpApi</span> structured search and the{" "}
            <span className="font-medium text-ink-2">You.com</span> Search &amp; Answer APIs. Sample data is labelled whenever sponsor keys are unavailable.
          </p>
        </div>
      ) : !run.isPending ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-5 py-14 text-center">
          <span className="mx-auto mb-3 inline-flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Zap className="size-5" aria-hidden />
          </span>
          <p className="text-[15px] font-semibold text-ink">Ready when you are</p>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-ink-2">
            LiveDesk queries SerpApi for structured web, news, jobs, shopping, maps and scholar results, then asks You.com for a cited answer. Both run in parallel.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Badge({ tone, children }: { tone: "good" | "warn"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
        tone === "good" ? "border-accent/30 bg-accent-soft text-accent" : "border-warn/30 bg-warn-soft text-warn",
      )}
    >
      {children}
    </span>
  );
}

function CollectionCard({ collection }: { collection: LiveDeskCollection }) {
  const Icon = ENGINE_ICONS[collection.engine] ?? Globe2;
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className="size-3.5 text-accent" aria-hidden />
          <h3 className="text-[12.5px] font-semibold text-ink">{collection.label}</h3>
          <span className="font-mono text-[10.5px] text-muted">{collection.engine}</span>
        </div>
        <div className="flex items-center gap-2">
          {collection.degraded ? <Badge tone="warn">sample</Badge> : <Badge tone="good">serpapi</Badge>}
          <span className="text-[11px] text-muted">{collection.hits.length}</span>
        </div>
      </header>
      <ul className="divide-y divide-line">
        {collection.hits.map((h, i) => (
          <li key={`${h.url}-${i}`} className="px-4 py-2.5">
            <a href={h.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2">
              <span className="mt-0.5 font-mono text-[10px] text-muted">{h.position}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start gap-1 text-[12.5px] font-medium leading-5 text-ink group-hover:text-accent">
                  <span className="truncate">{h.title}</span>
                  <ExternalLink className="mt-1 size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </span>
                {h.summary ? <span className="mt-0.5 block line-clamp-2 text-[11.5px] leading-[18px] text-ink-2">{h.summary}</span> : null}
                <span className="mt-1 block text-[10.5px] text-muted">
                  {h.source || h.url}
                  {h.published_at ? ` · ${h.published_at}` : ""}
                </span>
              </span>
            </a>
          </li>
        ))}
        {!collection.hits.length ? <li className="px-4 py-6 text-center text-[12px] text-muted">No results.</li> : null}
      </ul>
    </section>
  );
}
