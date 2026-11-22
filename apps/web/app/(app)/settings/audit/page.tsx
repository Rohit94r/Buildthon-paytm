"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronRight, ScrollText } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Card, Input, PageHeader, QueryView, Select, SkeletonRows, cn, td, th } from "@/components/ui";
import { Empty, SearchInput } from "@/components/platform/kit";
import { get } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { AuditEvent } from "@/lib/platform-ops-types";

type Range = "all" | "24h" | "7d" | "30d";
const RANGE_MS: Record<Range, number> = { all: Infinity, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<Range>("all");
  const [open, setOpen] = useState<string | null>(null);
  const actionQ = useDebounced(action.trim(), 300);
  const searchQ = useDebounced(search.trim().toLowerCase(), 150);

  const audit = useQuery({
    queryKey: ["audit", actionQ],
    queryFn: () => get<{ items: AuditEvent[] }>("/audit", { limit: 100, action: actionQ }),
    placeholderData: keepPreviousData,
  });

  const filtered = useMemo(() => {
    const now = Date.now();
    return (audit.data?.items ?? []).filter((e) => {
      if (range !== "all" && now - new Date(e.at).getTime() > RANGE_MS[range]) return false;
      if (!searchQ) return true;
      return [e.actor, e.entity, e.entity_id ?? "", e.action].some((v) => v.toLowerCase().includes(searchQ));
    });
  }, [audit.data, range, searchQ]);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Audit log" subtitle="Who changed what in this workspace: people, agents, API keys and support access." />

      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput className="min-w-[200px] flex-[2]" value={search} onChange={setSearch} placeholder="Search actor or entity…" />
        <Input className="min-w-[160px] flex-1 font-mono text-[12.5px]" value={action} onChange={(e) => setAction(e.target.value)} placeholder="action, e.g. member." aria-label="Filter by action" />
        <Select className="w-[140px]" value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Time range">
          <option value="all">Any time</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </Select>
      </div>

      <QueryView
        query={audit}
        skeleton={
          <Card>
            <SkeletonRows rows={8} />
          </Card>
        }
      >
        {() =>
          filtered.length === 0 ? (
            <Empty
              icon={<ScrollText />}
              title={audit.data?.items.length ? "No events match" : "No events yet"}
              body={audit.data?.items.length ? "Try a different search, action or time range." : "Changes to agents, workflows, members, keys and settings are recorded here."}
            />
          ) : (
            <Card className={cn("overflow-x-auto transition-opacity", audit.isFetching && audit.isPlaceholderData && "opacity-60")}>
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="border-b border-line">
                  <tr>
                    <th className={cn(th, "w-8")}>
                      <span className="sr-only">Details</span>
                    </th>
                    <th className={th}>Time</th>
                    <th className={th}>Actor</th>
                    <th className={th}>Action</th>
                    <th className={th}>Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const isOpen = open === e.id;
                    return (
                      <Fragment key={e.id}>
                        <tr className={cn("cursor-pointer border-b border-line hover:bg-surface-2/60", isOpen && "bg-surface-2/60")} onClick={() => setOpen(isOpen ? null : e.id)}>
                          <td className={cn(td, "py-2.5 pr-0")}>
                            <button type="button" aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "Show details"} className="rounded p-0.5 text-muted hover:text-ink">
                              <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
                            </button>
                          </td>
                          <td className={cn(td, "py-2.5 whitespace-nowrap text-ink-2")} title={dateTime(e.at, "d MMM yyyy, HH:mm:ss")}>
                            {ago(e.at)}
                          </td>
                          <td className={cn(td, "max-w-[240px] truncate py-2.5 text-ink")} title={e.actor}>
                            {e.actor}
                          </td>
                          <td className={cn(td, "py-2.5")}>
                            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">{e.action}</span>
                          </td>
                          <td className={cn(td, "py-2.5 text-ink-2")}>
                            {e.entity}
                            {e.entity_id ? <span className="ml-1.5 font-mono text-[11.5px] text-muted">{e.entity_id}</span> : null}
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr className="border-b border-line bg-surface-2/40">
                            <td />
                            <td colSpan={4} className="px-3 pt-1 pb-3">
                              <p className="mb-1.5 text-xs text-muted">{dateTime(e.at, "EEEE d MMM yyyy, HH:mm:ss")}</p>
                              {Object.keys(e.detail ?? {}).length ? (
                                <pre className="overflow-x-auto rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-ink">{JSON.stringify(e.detail, null, 2)}</pre>
                              ) : (
                                <p className="text-[12.5px] text-muted">No extra detail recorded.</p>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              <p className="border-t border-line px-4 py-2 text-xs text-muted">
                Showing {filtered.length} of the latest {audit.data?.items.length ?? 0} events
              </p>
            </Card>
          )
        }
      </QueryView>
    </div>
  );
}
