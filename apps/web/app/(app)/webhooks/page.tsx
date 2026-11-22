"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plug, RefreshCw, Webhook, Workflow } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, PageHeader, QueryView, SkeletonRows, cn, td, th } from "@/components/ui";
import { CodeBlock, CopyField, Empty, FilterChips, Section, StatusPill } from "@/components/platform/kit";
import { get } from "@/lib/api";
import { ago, dateTime, ms } from "@/lib/format";
import type { WebhookDelivery } from "@/lib/platform-ops-types";
import type { Connection, ConnectionKind, Pipeline } from "@/lib/platform-types";

/** Connection kinds that LayerFlow calls over HTTP (first in the list). */
const OUTBOUND: ConnectionKind[] = ["nextjs", "webhook", "slack", "discord", "rest_api", "wordpress", "ghost", "telegram", "linkedin", "email_smtp", "x"];

export default function WebhooksPage() {
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Webhooks" subtitle="Start workflows from anywhere with an inbound URL, and see every delivery LayerFlow sends to your sites and channels." />
      <div className="space-y-12">
        <Inbound />
        <Outbound />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inbound: pipeline webhook triggers                                   */
/* ------------------------------------------------------------------ */

function Inbound() {
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => get<{ items: Pipeline[] }>("/pipelines") });
  return (
    <Section title="Inbound" subtitle="POST to a workflow's URL from a form, cron job or Zapier to start a run. The token in the URL is the only auth, so keep it private.">
      <QueryView
        query={pipelines}
        skeleton={
          <Card>
            <SkeletonRows rows={3} />
          </Card>
        }
        isEmpty={(d) => !d.items.some((p) => p.trigger.type === "webhook")}
        empty={
          <Empty
            icon={<Workflow />}
            title="No webhook-triggered workflows"
            body="Set a workflow's trigger to Webhook and its URL appears here."
            action={
              <Link href="/pipelines" className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink shadow-sm hover:bg-surface-2">
                Open workflows
              </Link>
            }
          />
        }
      >
        {(d) => (
          <div className="space-y-3">
            {d.items
              .filter((p) => p.trigger.type === "webhook")
              .map((p) => (
                <InboundCard key={p.id} pipeline={p} />
              ))}
          </div>
        )}
      </QueryView>
    </Section>
  );
}

function InboundCard({ pipeline: p }: { pipeline: Pipeline }) {
  const [open, setOpen] = useState(false);
  const url = p.trigger.webhook_url;
  const example = `curl -X POST "${url ?? "WEBHOOK_URL"}" \\
  -H "Content-Type: application/json" \\
  -d '{"input":{"url":"https://example.org/page","data":{"name":"Asha"}}}'

# → { "run_id": "…" }`;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[14px] font-semibold text-ink">{p.name}</p>
        {!p.enabled ? <StatusPill status="disabled" /> : null}
        <span className="text-[12.5px] text-muted">{p.last_run?.started_at ? `Last run ${ago(p.last_run.started_at)}` : "Never run"}</span>
        <span className="flex-1" />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-ink">
          Example
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      <div className="mt-3">{url ? <CopyField value={url} /> : <p className="text-[13px] text-muted">The URL is generated when the workflow is saved with a webhook trigger.</p>}</div>
      {open ? <CodeBlock className="mt-3" code={example} title="curl" /> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Outbound: delivery history per connection                            */
/* ------------------------------------------------------------------ */

function Outbound() {
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => get<{ items: Connection[] }>("/connections") });
  const list = [...(connections.data?.items ?? [])].sort((a, b) => OUTBOUND.indexOf(a.kind) - OUTBOUND.indexOf(b.kind));
  const [picked, setPicked] = useState<string>("");
  const selected = list.find((c) => c.id === picked) ?? list[0];

  return (
    <Section title="Outbound deliveries" subtitle="Signed POSTs and posts LayerFlow sent through your connections. Failed deliveries retry 3 times (30s, 2m, 10m).">
      <QueryView
        query={connections}
        skeleton={
          <Card>
            <SkeletonRows rows={4} />
          </Card>
        }
        isEmpty={(d) => d.items.length === 0}
        empty={
          <Empty
            icon={<Plug />}
            title="No connections yet"
            body="Add a Next.js, webhook, Slack or other connection to see its deliveries here."
            action={
              <Link href="/connections" className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink shadow-sm hover:bg-surface-2">
                Open connections
              </Link>
            }
          />
        }
      >
        {() =>
          selected ? (
            <div className="space-y-3">
              <FilterChips value={selected.id} onChange={setPicked} options={list.map((c) => ({ value: c.id, label: c.name }))} />
              <Deliveries connection={selected} />
            </div>
          ) : null
        }
      </QueryView>
    </Section>
  );
}

function Deliveries({ connection }: { connection: Connection }) {
  const q = useQuery({
    queryKey: ["deliveries", connection.id],
    queryFn: () => get<{ items: WebhookDelivery[] }>(`/connections/${connection.id}/deliveries`),
  });
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <p className="min-w-0 truncate text-[12.5px] text-muted">
          <span className="font-medium text-ink-2">{connection.name}</span>
          {q.data?.items[0]?.url ? <span className="font-mono"> · {q.data.items[0].url}</span> : null}
        </p>
        <Button variant="ghost" size="xs" icon={<RefreshCw className={cn("size-3", q.isFetching && "animate-spin")} />} onClick={() => q.refetch()}>
          Refresh
        </Button>
      </div>
      <QueryView
        query={q}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Webhook className="mb-2 size-5 text-muted" />
            <p className="text-[13.5px] font-medium text-ink">No deliveries yet</p>
            <p className="mt-0.5 text-[12.5px] text-muted">They appear here when an agent publishes or notifies through this connection.</p>
          </div>
        }
      >
        {(d) => (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Event</th>
                  <th className={th}>Result</th>
                  <th className={th}>Status</th>
                  <th className={th}>Attempts</th>
                  <th className={th}>Duration</th>
                  <th className={th}>Time</th>
                  <th className={th}>Error</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((x) => (
                  <tr key={x.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                    <td className={cn(td, "py-2.5 font-mono text-[12px] text-ink")}>{x.event}</td>
                    <td className={cn(td, "py-2.5")}>{x.ok ? <StatusPill status="succeeded" label="Delivered" /> : <StatusPill status="failed" />}</td>
                    <td className={cn(td, "py-2.5 font-mono text-[12px] tabular", x.ok ? "text-ink-2" : "text-bad")}>{x.status_code ?? "—"}</td>
                    <td className={cn(td, "py-2.5 text-ink-2 tabular")}>{x.attempts}</td>
                    <td className={cn(td, "py-2.5 text-ink-2 tabular")}>{ms(x.duration_ms)}</td>
                    <td className={cn(td, "py-2.5 whitespace-nowrap text-ink-2")} title={dateTime(x.at)}>
                      {ago(x.at)}
                    </td>
                    <td className={cn(td, "max-w-[280px] py-2.5")}>
                      {x.error ? (
                        <button type="button" onClick={() => setOpenId(openId === x.id ? null : x.id)} className={cn("text-left text-[12.5px] text-bad", openId === x.id ? "break-words" : "line-clamp-1")} title={x.error}>
                          {x.error}
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
    </Card>
  );
}
