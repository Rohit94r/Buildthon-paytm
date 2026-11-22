"use client";

// Guided 2-step setup for a plain-language task: pick (or reuse) the right catalogue agent, ask for a URL and
// "what do you want?", save that into the agent's settings, run it, and open its live activity.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Banner, Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { errorMessage, get, patch, post } from "@/lib/api";
import type { CatalogAgent, ManagedAgent } from "@/lib/platform-ops-types";
import type { AgentType, ConfigField, PipelineRun } from "@/lib/platform-types";
import { AgentGlyph } from "./kit";

export interface QuickTask {
  id: string;
  title: string;
  keys: string[]; // catalogue keys, best first
  url?: { label: string; placeholder: string; required?: boolean };
  ask: { label: string; placeholder: string; hint?: string };
}

/** Puts the user's URL and wish into whatever settings this agent type has. */
function applyInputs(schema: ConfigField[], config: Record<string, unknown>, url: string, want: string): Record<string, unknown> {
  const next = { ...config };
  const wants = want
    .split(/,|\band\b|\n/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 8);
  for (const f of schema) {
    if (url) {
      if (f.type === "sources") next[f.key] = [{ url, type: /rss|feed|\.xml$/i.test(url) ? "rss" : "html" }];
      else if (f.type === "text" && /url|site|page|start/i.test(f.key)) next[f.key] = url;
      else if (f.type === "string_list" && /url|page|watch|site/i.test(f.key)) next[f.key] = [url];
    }
    if (want) {
      if (f.type === "extract_fields" && wants.length)
        next[f.key] = wants.map((w) => ({ key: w.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field", label: w.replace(/^\w/, (c) => c.toUpperCase()), type: /price|cost|fee|₹|\$/i.test(w) ? "currency" : /rating|stars|score|count|number/i.test(w) ? "number" : /date|deadline/i.test(w) ? "date" : "text" }));
      else if (f.type === "string_list" && /keyword|topic|query|term|seed/i.test(f.key)) next[f.key] = wants;
      else if ((f.type === "textarea" || f.type === "text") && /topic|question|instruction|brief|prompt|query|what/i.test(f.key)) next[f.key] = want;
    }
  }
  return next;
}

export function QuickStartDialog({ task, onClose }: { task: QuickTask | null; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => get<{ items: CatalogAgent[] }>("/catalog"), enabled: Boolean(task) });
  const types = useQuery({ queryKey: ["agent-types"], queryFn: () => get<{ items: AgentType[] }>("/agent-types"), staleTime: Infinity, enabled: Boolean(task) });
  const options = useMemo(() => (task ? task.keys.map((k) => catalog.data?.items.find((c) => c.key === k)).filter((x): x is CatalogAgent => Boolean(x)) : []), [task, catalog.data]);
  const [key, setKey] = useState<string>("");
  const [url, setUrl] = useState("");
  const [want, setWant] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setUrl("");
    setWant("");
    setError(null);
    setBusy(null);
  }, [task]);
  useEffect(() => {
    const first = options.find((o) => o.entitled) ?? options[0];
    if (first) setKey(first.key);
  }, [options]);
  const entry = options.find((o) => o.key === key);
  const needsUrl = Boolean(task?.url?.required);
  const reason = !entry ? "Loading agents…" : !entry.entitled ? "This agent needs a bigger plan" : needsUrl && !/^https?:\/\/\S+\.\S+/.test(url.trim()) ? "Paste a full web address, starting with https://" : !want.trim() ? "Tell the agent what you want" : null;

  const go = async () => {
    if (!entry || !task) return;
    setError(null);
    try {
      let agentId = entry.activated_agent_ids[0];
      if (!agentId) {
        setBusy("Setting up your agent…");
        agentId = (await post<ManagedAgent>(`/catalog/${entry.key}/activate`, {})).id;
      }
      setBusy("Saving your choices…");
      const agent = await get<ManagedAgent>(`/agents/${agentId}`);
      const schema = types.data?.items.find((t) => t.kind === agent.kind)?.config_schema ?? [];
      const config = applyInputs(schema, agent.config, url.trim(), want.trim());
      if (JSON.stringify(config) !== JSON.stringify(agent.config)) await patch(`/agents/${agentId}`, { config, version_note: `Quick start: ${task.title}` });
      if (agent.status !== "active") await post(`/agents/${agentId}/resume`);
      setBusy("Starting…");
      await post<PipelineRun>(`/agents/${agentId}/run`, { input: { url: url.trim() || undefined, text: want.trim() } });
      for (const k of [["catalog"], ["agents"], ["agents-overview"], ["progress"], ["activity"]]) void qc.invalidateQueries({ queryKey: k });
      onClose();
      router.push(`/agents/${agentId}?tab=activity`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={Boolean(task)}
      onClose={onClose}
      title={task?.title ?? ""}
      description="Two quick questions, then your agent gets to work. You can fine-tune everything later."
      footer={
        <Button variant="primary" size="lg" loading={Boolean(busy)} disabledReason={busy ? null : reason} onClick={go}>
          {busy ?? (
            <>
              Start <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      }
    >
      {catalog.isPending ? (
        <p className="flex items-center gap-2 py-6 text-[13px] text-muted">
          <Loader2 className="size-4 animate-spin" /> Finding the right agent…
        </p>
      ) : (
        <div className="space-y-5">
          {entry ? (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
              <AgentGlyph kind={entry.kind} icon={entry.icon} category={entry.kind_category} />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-ink">{entry.name}</p>
                <p className="text-[12.5px] text-ink-2">{entry.everyday_use || entry.tagline}</p>
              </div>
              {options.length > 1 ? (
                <Select className="w-44" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Choose an agent">
                  {options.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          ) : (
            <Banner tone="warn" title="This agent isn't in your catalogue yet" />
          )}
          {task?.url ? (
            <Field label={<span className="text-[13.5px] text-ink">1. {task.url.label}</span>} hint={task.url.required ? undefined : "Optional"}>
              <Input className="h-11 text-[14px]" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={task.url.placeholder} autoFocus />
            </Field>
          ) : null}
          <Field label={<span className="text-[13.5px] text-ink">{task?.url ? "2. " : ""}{task?.ask.label}</span>} hint={task?.ask.hint}>
            <Textarea rows={3} className="text-[14px]" value={want} onChange={(e) => setWant(e.target.value)} placeholder={task?.ask.placeholder} />
          </Field>
          {error ? (
            <Banner tone="bad" title="That didn't work">
              {error}
            </Banner>
          ) : null}
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <Sparkles className="size-3.5" /> You&apos;ll watch it work live, step by step.
          </p>
        </div>
      )}
    </Dialog>
  );
}
