"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound, Plus, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Banner, Button, Card, Dialog, Field, Input, PageHeader, Select, SkeletonRows, Tabs, QueryView, cn, td, th } from "@/components/ui";
import { CodeBlock, CopyField, Empty, Section, StatusPill, usePermissions } from "@/components/platform/kit";
import { del, get, post } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { ApiKey, ApiKeyCreated, ApiScope, Pipeline } from "@/lib/platform-types";

const SCOPES: { value: ApiScope; label: string; hint: string }[] = [
  { value: "content:read", label: "Read content", hint: "Published posts and the RSS feed" },
  { value: "datasets:read", label: "Read datasets", hint: "Records of public datasets" },
  { value: "assistant:chat", label: "Assistant chat", hint: "The only scope safe to expose in a browser (embed widget)" },
  { value: "runs:write", label: "Start runs", hint: "Run workflows and agents from your app" },
  { value: "runs:read", label: "Read runs", hint: "Run status and output" },
];

type Tab = "keys" | "sdk";

export default function DevelopersPage() {
  const [tab, setTab] = useState<Tab>("keys");
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="API keys & SDK" subtitle="Let your website, app or backend read content and data, chat with the assistant, and start workflows." />
      <Tabs<Tab>
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "keys", label: "API keys" },
          { value: "sdk", label: "SDK & API" },
        ]}
      />
      {tab === "keys" ? <KeysTab /> : <SdkTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* API keys                                                             */
/* ------------------------------------------------------------------ */

function KeysTab() {
  const perms = usePermissions();
  const reason = perms.reason("integrations.manage");
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => get<{ items: ApiKey[] }>("/api-keys") });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const revoke = useAction((k: ApiKey) => del(`/api-keys/${k.id}`), {
    success: (_r, k) => `${k.name} revoked`,
    invalidate: [["api-keys"]],
    onSuccess: () => setRevoking(null),
  });

  const createButton = (
    <Button variant="primary" icon={<Plus className="size-3.5" />} disabledReason={reason} onClick={() => setCreating(true)}>
      Create key
    </Button>
  );

  return (
    <Section title="API keys" subtitle="Each key belongs to this workspace and can only do what its scopes allow." actions={keys.data?.items.length ? createButton : undefined}>
      <QueryView
        query={keys}
        skeleton={
          <Card>
            <SkeletonRows rows={4} />
          </Card>
        }
        isEmpty={(d) => d.items.length === 0}
        empty={<Empty icon={<KeyRound />} title="No API keys yet" body="Create a key for your website or app. You'll see the secret once, right after creating it." action={createButton} />}
      >
        {(d) => (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="border-b border-line">
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Key</th>
                  <th className={th}>Scopes</th>
                  <th className={th}>Last used</th>
                  <th className={th}>Status</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((k) => (
                  <tr key={k.id} className={cn("border-b border-line last:border-0", k.revoked && "opacity-60")}>
                    <td className={cn(td, "py-3")}>
                      <p className="font-medium text-ink">{k.name}</p>
                      <p className="text-xs text-muted" title={dateTime(k.created_at)}>
                        Created {ago(k.created_at)}
                      </p>
                    </td>
                    <td className={cn(td, "py-3 font-mono text-[12px] text-ink-2")}>{k.prefix}…</td>
                    <td className={cn(td, "py-3")}>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} tone={s.startsWith("runs:") ? "accent" : "neutral"}>
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className={cn(td, "py-3 text-ink-2")} title={k.last_used_at ? dateTime(k.last_used_at) : undefined}>
                      {k.last_used_at ? ago(k.last_used_at) : "Never"}
                    </td>
                    <td className={cn(td, "py-3")}>{k.revoked ? <StatusPill status="disabled" label="Revoked" /> : <StatusPill status="active" />}</td>
                    <td className={cn(td, "py-3 text-right")}>
                      {!k.revoked ? (
                        <Button variant="ghost" disabledReason={reason} onClick={() => setRevoking(k)}>
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </QueryView>

      {creating ? <CreateKeyDialog onClose={() => setCreating(false)} /> : null}

      <Dialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        size="sm"
        title="Revoke this key?"
        description={revoking ? `${revoking.name} (${revoking.prefix}…) stops working immediately.` : undefined}
        footer={
          <>
            <Button onClick={() => setRevoking(null)}>Cancel</Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking)}>
              Revoke key
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">Any site, widget or app using it will get 401 errors until you give it a new key. This can&apos;t be undone.</p>
      </Dialog>
    </Section>
  );
}

function CreateKeyDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["content:read"]);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);

  const create = useAction(() => post<ApiKeyCreated>("/api-keys", { name: name.trim(), scopes }), {
    success: "API key created",
    invalidate: [["api-keys"]],
    onSuccess: (r) => setCreated(r),
  });

  const toggle = (s: ApiScope) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const browserUnsafe = scopes.includes("assistant:chat") && scopes.length > 1;

  if (created) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Copy your new key"
        description={`${created.key.name} · ${created.key.scopes.join(", ")}`}
        footer={
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <CopyField value={created.secret} />
          <Banner tone="warn" title="This is the only time the secret is shown">
            Store it in your site&apos;s environment variables now. If you lose it, revoke this key and create a new one.
          </Banner>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Create API key"
      description="Give the key only the scopes it needs."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabledReason={!name.trim() ? "Give the key a name" : scopes.length === 0 ? "Pick at least one scope" : null}
            onClick={() => create.mutate(undefined)}
          >
            Create key
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && scopes.length) create.mutate(undefined);
        }}
      >
        <Field label="Name" hint="Where it's used, e.g. “website” or “mobile app”.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="website" />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-ink-2">Scopes</legend>
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {SCOPES.map((s) => (
              <label key={s.value} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-surface-2">
                <input type="checkbox" className="mt-0.5 size-3.5 accent-[var(--accent)]" checked={scopes.includes(s.value)} onChange={() => toggle(s.value)} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
                    {s.label}
                    <span className="font-mono text-[11px] font-normal text-muted">{s.value}</span>
                  </span>
                  <span className="block text-xs text-ink-2">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {browserUnsafe ? (
          <p className="flex items-start gap-2 text-xs text-warn">
            <ShieldAlert className="mt-px size-3.5 shrink-0" />
            For the embed widget, create a separate key with only assistant:chat. Its key is visible in the page source.
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* SDK & API                                                            */
/* ------------------------------------------------------------------ */

type Lang = "ts" | "python" | "curl" | "mcp";

function SdkTab() {
  const [origin, setOrigin] = useState("https://YOUR-LAYERFLOW-DOMAIN");
  useEffect(() => setOrigin(window.location.origin), []);
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: () => get<{ items: Pipeline[] }>("/pipelines") });
  const [picked, setPicked] = useState<string>("");
  const [lang, setLang] = useState<Lang>("ts");

  const items = pipelines.data?.items ?? [];
  const pipelineId = picked || items[0]?.id || "PIPELINE_ID";

  const ts = `import { LayerFlow } from "@layerflow/sdk";

const lf = new LayerFlow({ baseUrl: "${origin}", apiKey: process.env.LAYERFLOW_API_KEY! });

// Start the workflow and wait for the result
const run = await lf.workflows.run("${pipelineId}", { input: { url: "https://example.org/event" } }, { wait: true });
if (run.status === "succeeded") console.log(run.output?.items);

// Read content and data
const { items: posts } = await lf.content.list({ limit: 10 });
const { items: records } = await lf.datasets.records("colleges", { sort: "nirf_rank:asc" });`;

  const py = `from layerflow import LayerFlow

lf = LayerFlow("${origin}", api_key="lf_pk_...")

run = lf.workflows.run("${pipelineId}", input={"url": "https://example.org"}, wait=True, idempotency_key="lead-123")
print(run["status"], run["output"])`;

  const curl = `# 1. Start a run (the same Idempotency-Key within 24h returns the original run)
curl -X POST "${origin}/api/public/v1/workflows/${pipelineId}/run" \\
  -H "Authorization: Bearer lf_pk_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: lead-123" \\
  -d '{"input":{"url":"https://example.org/event"}}'

# 2. Poll until status is succeeded / failed (use the "id" from step 1)
curl "${origin}/api/public/v1/runs/RUN_ID" \\
  -H "Authorization: Bearer lf_pk_..."`;

  const mcp = `{
  "mcpServers": {
    "layerflow": {
      "command": "python",
      "args": ["/path/to/integrations/mcp/layerflow_mcp.py"],
      "env": {
        "LAYERFLOW_URL": "${origin}",
        "LAYERFLOW_API_KEY": "lf_pk_..."
      }
    }
  }
}`;

  const snippets: Record<Lang, { code: string; title: string; note: string }> = {
    ts: { code: ts, title: "TypeScript · @layerflow/sdk", note: "Zero dependencies. Node 18+, Next.js (server), Bun, Deno and edge runtimes. Install from packages/sdk-typescript." },
    python: { code: py, title: "Python · layerflow", note: "Standard library only (Python 3.9+). Install with pip install ./packages/sdk-python." },
    curl: { code: curl, title: "curl · run + poll", note: "Needs a key with runs:write to start and runs:read to poll." },
    mcp: {
      code: mcp,
      title: "claude_desktop_config.json",
      note: "Optional: exposes this workspace to MCP clients as tools (list_content, search_dataset, ask_assistant, run_workflow, get_run). Install with pip install \"./packages/sdk-python[mcp]\".",
    },
  };
  const s = snippets[lang];

  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <Field label="Workflow" className="min-w-[220px] flex-1" hint={items.length ? "Its id is filled into the snippets below." : undefined}>
          {pipelines.isPending ? (
            <Select disabled>
              <option>Loading…</option>
            </Select>
          ) : items.length ? (
            <Select value={pipelineId} onChange={(e) => setPicked(e.target.value)}>
              {items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="flex h-9 items-center text-[13px] text-muted">
              No workflows yet —&nbsp;
              <Link href="/pipelines" className="text-accent hover:underline">
                create one
              </Link>
            </p>
          )}
        </Field>
        <div className="min-w-[220px] flex-1">
          <CopyField label="ID" value={pipelineId} />
        </div>
      </Card>

      <div>
        <Tabs<Lang>
          className="mb-4"
          value={lang}
          onChange={setLang}
          tabs={[
            { value: "ts", label: "TypeScript" },
            { value: "python", label: "Python" },
            { value: "curl", label: "curl" },
            { value: "mcp", label: "MCP" },
          ]}
        />
        <p className="mb-3 text-[13px] text-ink-2">{s.note}</p>
        <CodeBlock code={s.code} title={s.title} />
      </div>

      <Banner tone="neutral" title="Keep server keys on the server">
        Keys with content, dataset or run scopes belong in environment variables. Only an assistant:chat key may appear in a browser.
      </Banner>
    </div>
  );
}
