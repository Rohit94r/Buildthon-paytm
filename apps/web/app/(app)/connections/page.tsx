"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Braces,
  CheckCircle2,
  ChevronDown,
  Ghost,
  Hash,
  Linkedin,
  Mail,
  MessageCircle,
  Newspaper,
  Plug,
  Plus,
  Send,
  Settings2,
  Trash2,
  Triangle,
  Twitter,
  Webhook,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Banner, Button, Card, Dialog, Drawer, ErrorState, Field, Input, PageHeader, Select, Skeleton, Tabs, Textarea, Toggle, cn } from "@/components/ui";
import { CodeBlock, Empty, Section, StatusPill, usePermissions } from "@/components/platform/kit";
import { del, errorMessage, get, patch, post } from "@/lib/api";
import { ago, dateTime, ms } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { WebhookDelivery } from "@/lib/platform-ops-types";
import type { ConfigField, Connection, ConnectionKind, ConnectionKindInfo, ConnectionTestResult } from "@/lib/platform-types";

/* ------------------------------------------------------------------ */
/* Friendly names and icons per connection kind                         */
/* ------------------------------------------------------------------ */

const FRIENDLY_NAME: Record<ConnectionKind, string> = {
  nextjs: "Your website (Next.js)",
  wordpress: "WordPress site",
  webhook: "Webhook",
  linkedin: "LinkedIn",
  telegram: "Telegram channel",
  x: "X (Twitter)",
  ghost: "Ghost blog",
  slack: "Slack",
  discord: "Discord",
  email_smtp: "Email",
  rest_api: "Any API",
};

const friendlyName = (kind: ConnectionKind, info?: ConnectionKindInfo | null) => FRIENDLY_NAME[kind] ?? info?.name ?? kind;

/** Kinds that can send one real test message/post, and what we call it. */
const SENDABLE: Partial<Record<ConnectionKind, "message" | "post">> = {
  telegram: "message",
  slack: "message",
  discord: "message",
  email_smtp: "message",
  linkedin: "post",
  x: "post",
  webhook: "post",
  nextjs: "post",
  wordpress: "post",
};

const KIND_ICONS: Record<string, LucideIcon> = {
  Triangle,
  Newspaper,
  Webhook,
  Linkedin,
  Twitter,
  Send,
  Ghost,
  Hash,
  MessageCircle,
  Mail,
  Braces,
};
const FALLBACK_ICON: Record<ConnectionKind, LucideIcon> = {
  nextjs: Triangle,
  wordpress: Newspaper,
  webhook: Webhook,
  linkedin: Linkedin,
  telegram: Send,
  x: Twitter,
  ghost: Ghost,
  slack: Hash,
  discord: MessageCircle,
  email_smtp: Mail,
  rest_api: Braces,
};

function KindIcon({ kind, icon, size = "md" }: { kind: ConnectionKind; icon?: string; size?: "md" | "lg" }) {
  const Icon = (icon && KIND_ICONS[icon]) || FALLBACK_ICON[kind] || Plug;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-line bg-surface-2 text-ink",
        size === "lg" ? "size-11 rounded-xl [&_svg]:size-5" : "size-10 rounded-xl [&_svg]:size-[18px]",
      )}
      aria-hidden
    >
      <Icon />
    </span>
  );
}

/** "content.published" → "Content published". */
function eventLabel(event: string): string {
  const s = event.replace(/[._]/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Delivery";
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

type DrawerState = { mode: "closed" } | { mode: "create"; kind?: ConnectionKind } | { mode: "edit"; connection: Connection };

export default function ConnectionsPage() {
  const perms = usePermissions();
  const manageReason = perms.reason("integrations.manage");

  const connections = useQuery({ queryKey: ["connections"], queryFn: () => get<{ items: Connection[] }>("/connections") });
  const kinds = useQuery({ queryKey: ["connection-kinds"], queryFn: () => get<{ items: ConnectionKindInfo[] }>("/connection-kinds"), staleTime: 5 * 60_000 });
  const kindMap = new Map((kinds.data?.items ?? []).map((k) => [k.kind, k]));

  const [drawer, setDrawer] = useState<DrawerState>({ mode: "closed" });
  const [toDelete, setToDelete] = useState<Connection | null>(null);

  const remove = useAction((c: Connection) => del(`/connections/${c.id}`), {
    success: (_r, c) => `${c.name} removed`,
    invalidate: [["connections"]],
    onSuccess: () => setToDelete(null),
  });

  const items = connections.data?.items ?? [];

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Connections"
        subtitle="The places your agents can post to and send messages: your website, social accounts, chat apps and email."
        actions={
          <Button variant="primary" size="md" icon={<Plus className="size-4" />} disabledReason={manageReason} onClick={() => setDrawer({ mode: "create" })}>
            Add connection
          </Button>
        }
      />

      {connections.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[200px] rounded-xl" />
          ))}
        </div>
      ) : connections.isError ? (
        <Card>
          <ErrorState error={connections.error} onRetry={() => connections.refetch()} />
        </Card>
      ) : items.length === 0 ? (
        <Empty
          icon={<Plug />}
          title="Nothing connected yet"
          body="Connect your website or a channel so your agents can post there. You stay in control: content waits for your approval whenever the workflow asks for it."
          action={
            <Button variant="primary" icon={<Plus className="size-3.5" />} disabledReason={manageReason} onClick={() => setDrawer({ mode: "create" })}>
              Add your first connection
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              info={kindMap.get(c.kind)}
              manageReason={manageReason}
              onOpen={() => setDrawer({ mode: "edit", connection: c })}
              onDelete={() => setToDelete(c)}
            />
          ))}
        </div>
      )}

      <ConnectSite onSetup={(kind) => setDrawer({ mode: "create", kind })} manageReason={manageReason} />

      {drawer.mode !== "closed" ? (
        <ConnectionDrawer
          key={drawer.mode === "edit" ? drawer.connection.id : `new-${drawer.kind ?? ""}`}
          state={drawer}
          kinds={kinds.data?.items ?? []}
          kindsLoading={kinds.isPending}
          kindsError={kinds.isError ? kinds.error : null}
          manageReason={manageReason}
          onClose={() => setDrawer({ mode: "closed" })}
        />
      ) : null}

      <Dialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        size="sm"
        title="Remove this connection?"
        description={toDelete ? `${toDelete.name} will be removed. Agents that post there will skip it from now on.` : undefined}
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>Keep it</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => toDelete && remove.mutate(toDelete)}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">The saved passwords and keys are deleted too. You can connect it again at any time.</p>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Test result                                                          */
/* ------------------------------------------------------------------ */

function ResultBox({ result, what }: { result: ConnectionTestResult; what: "test" | "message" | "post" }) {
  const title = result.ok
    ? what === "test"
      ? "Connected. Everything works."
      : `Test ${what} sent. Go and check it arrived.`
    : what === "test"
      ? "We couldn't connect"
      : `We couldn't send the test ${what}`;
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", result.ok ? "border-ok/25 bg-ok-soft" : "border-bad/25 bg-bad-soft")} role={result.ok ? "status" : "alert"}>
      {result.ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden /> : <XCircle className="mt-0.5 size-5 shrink-0 text-bad" aria-hidden />}
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        <p className={cn("font-semibold", result.ok ? "text-ok" : "text-bad")}>{title}</p>
        {result.ok ? (
          <p className="mt-0.5 break-words text-ink-2">
            {result.detail}
            {result.latency_ms !== null ? <span className="text-muted"> · answered in {ms(result.latency_ms)}</span> : null}
          </p>
        ) : (
          <>
            <p className="mt-0.5 break-words text-ink">
              <span className="font-medium">What to fix: </span>
              {result.detail}
            </p>
            <p className="mt-1 text-[12.5px] text-ink-2">Check the details, save, and try again.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Test (or send a real test message) for a saved connection. */
function useConnectionTest(id: string | null, send: boolean, onDone: (r: ConnectionTestResult) => void) {
  return useAction(
    () => {
      if (!id) throw new Error("Save the connection first");
      return post<ConnectionTestResult>(`/connections/${id}/test`, send ? { send: true } : {});
    },
    {
      silent: true,
      invalidate: [["connections"]],
      onSuccess: (r) => onDone(r),
      onError: (e) => onDone({ ok: false, detail: errorMessage(e), latency_ms: null }),
    },
  );
}

/* ------------------------------------------------------------------ */
/* Connection card                                                      */
/* ------------------------------------------------------------------ */

function ConnectionCard({
  connection: c,
  info,
  manageReason,
  onOpen,
  onDelete,
}: {
  connection: Connection;
  info?: ConnectionKindInfo;
  manageReason: string | null;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const test = useConnectionTest(c.id, false, setResult);
  const deliveries = useQuery({
    queryKey: ["connections", c.id, "deliveries"],
    queryFn: () => get<{ items: WebhookDelivery[] }>(`/connections/${c.id}/deliveries`),
    select: (d) => [...(d.items ?? [])].sort((a, b) => (a.at < b.at ? 1 : -1)),
    retry: false,
    staleTime: 30_000,
  });
  const list = deliveries.data ?? [];
  const last = list[0];
  const manual = info && !info.auto_publish;

  return (
    <Card className="flex flex-col">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <KindIcon kind={c.kind} icon={info?.icon} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-ink">{c.name}</p>
            <p className="truncate text-[12.5px] text-muted">{friendlyName(c.kind, info)}</p>
          </div>
          <StatusPill status={c.status} />
        </div>

        <div className="mt-4 space-y-1.5 text-[13px]">
          {deliveries.isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : last ? (
            <p className="flex items-center gap-1.5" title={dateTime(last.at)}>
              {last.ok ? <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden /> : <XCircle className="size-4 shrink-0 text-bad" aria-hidden />}
              <span className={last.ok ? "text-ink" : "text-bad"}>{last.ok ? "Last delivery worked" : "Last delivery failed"}</span>
              <span className="text-muted">· {ago(last.at)}</span>
            </p>
          ) : (
            <p className="text-muted">{c.last_used_at ? `Last used ${ago(c.last_used_at)}` : "Nothing sent here yet"}</p>
          )}
          {manual ? <p className="text-[12.5px] text-muted">Posts are prepared for you to copy and paste.</p> : null}
          {c.status === "needs_setup" ? <p className="text-[12.5px] text-warn">A few details are missing. Open it to finish setting up.</p> : null}
          {c.last_error ? <p className="line-clamp-2 text-[12.5px] text-bad">Last problem: {c.last_error}</p> : null}
        </div>

        {result ? (
          <div className="mt-4">
            <ResultBox result={result} what="test" />
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Settings2 className="size-3.5" />} disabledReason={manageReason} onClick={onOpen}>
            Set up &amp; test
          </Button>
          <Button icon={<Zap className="size-3.5" />} loading={test.isPending} disabledReason={manageReason} onClick={() => test.mutate(undefined)}>
            Quick test
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" aria-label={`Remove ${c.name}`} title="Remove" disabledReason={manageReason} icon={<Trash2 className="size-3.5" />} onClick={onDelete} />
        </div>
      </div>

      <div className="border-t border-line">
        {deliveries.isError ? (
          <p className="px-5 py-3 text-[12.5px] text-muted">Delivery history isn&apos;t available right now.</p>
        ) : (
          <button
            type="button"
            onClick={() => setShowDeliveries((v) => !v)}
            disabled={!list.length}
            aria-expanded={showDeliveries}
            className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left text-[12.5px] font-medium text-ink-2 hover:text-ink disabled:cursor-default disabled:text-muted"
          >
            <span>
              Recent deliveries
              {list.length ? <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2 tabular">{list.length}</span> : <span className="ml-1 font-normal">· none yet</span>}
            </span>
            {list.length ? <ChevronDown className={cn("size-4 transition-transform", showDeliveries && "rotate-180")} aria-hidden /> : null}
          </button>
        )}
        {showDeliveries && list.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {list.slice(0, 10).map((d) => (
              <DeliveryRow key={d.id} d={d} />
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function DeliveryRow({ d }: { d: WebhookDelivery }) {
  return (
    <li className="px-5 py-2.5 text-[12.5px]">
      <div className="flex items-center gap-2">
        {d.ok ? <CheckCircle2 className="size-3.5 shrink-0 text-ok" aria-hidden /> : <XCircle className="size-3.5 shrink-0 text-bad" aria-hidden />}
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{eventLabel(d.event)}</span>
        <span className={cn("shrink-0", d.ok ? "text-ok" : "text-bad")}>{d.ok ? "Delivered" : "Failed"}</span>
      </div>
      <p className="mt-0.5 pl-[22px] text-[11.5px] text-muted tabular" title={dateTime(d.at)}>
        {ago(d.at)}
        {d.status_code !== null ? ` · code ${d.status_code}` : ""}
        {d.duration_ms !== null ? ` · ${ms(d.duration_ms)}` : ""}
        {d.attempts > 1 ? ` · ${d.attempts} tries` : ""}
      </p>
      {d.error ? <p className="mt-0.5 pl-[22px] text-[12px] leading-snug break-words text-bad">{d.error}</p> : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Set-up drawer                                                        */
/* ------------------------------------------------------------------ */

type Values = Record<string, unknown>;

function initialValues(info: ConnectionKindInfo, existing?: Connection | null): Values {
  const v: Values = {};
  for (const f of info.fields) {
    if (f.secret) v[f.key] = "";
    else if (existing && existing.config[f.key] !== undefined) v[f.key] = existing.config[f.key];
    else if (f.default !== undefined) v[f.key] = f.default;
    else v[f.key] = f.type === "boolean" ? false : f.type === "string_list" || f.type === "multiselect" ? [] : "";
  }
  return v;
}

function NumberCircle({ n, small }: { n: number; small?: boolean }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent tabular", small ? "size-7 text-[13px]" : "size-8 text-[14px]")} aria-hidden>
      {n}
    </span>
  );
}

function DrawerSection({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {hint ? <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ConnectionDrawer({
  state,
  kinds,
  kindsLoading,
  kindsError,
  manageReason,
  onClose,
}: {
  state: Exclude<DrawerState, { mode: "closed" }>;
  kinds: ConnectionKindInfo[];
  kindsLoading: boolean;
  kindsError: unknown;
  manageReason: string | null;
  onClose: () => void;
}) {
  // The saved connection: set from the start when editing, and after the first save when adding.
  const [conn, setConn] = useState<Connection | null>(state.mode === "edit" ? state.connection : null);
  const [kind, setKind] = useState<ConnectionKind | null>(state.mode === "edit" ? state.connection.kind : (state.kind ?? null));
  const info = kinds.find((k) => k.kind === kind) ?? null;

  const [name, setName] = useState(conn?.name ?? "");
  const [values, setValues] = useState<Values>({});
  const [ready, setReady] = useState<ConnectionKind | null>(null);
  const [dirty, setDirty] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [sendResult, setSendResult] = useState<ConnectionTestResult | null>(null);

  // (Re)initialise the form whenever the chosen kind's schema becomes available.
  useEffect(() => {
    if (info && ready !== info.kind) {
      setValues(initialValues(info, conn));
      if (!conn) setName(friendlyName(info.kind, info));
      setReady(info.kind);
    }
  }, [info, ready, conn]);

  const change = (fn: () => void) => {
    fn();
    setDirty(true);
    setTestResult(null);
    setSendResult(null);
  };

  const save = useAction(
    () => {
      if (!info) throw new Error("Pick what you want to connect first");
      const config: Values = {};
      for (const f of info.fields) {
        const v = values[f.key];
        if (f.secret) {
          if (typeof v === "string" && v.trim()) config[f.key] = v.trim();
          continue; // blank secret = keep the stored value
        }
        if (f.type === "number") config[f.key] = v === "" || v === null || v === undefined ? null : Number(v);
        else if (f.type === "string_list") config[f.key] = (Array.isArray(v) ? (v as string[]) : []).map((x) => x.trim()).filter(Boolean);
        else config[f.key] = v;
      }
      const finalName = name.trim() || friendlyName(info.kind, info);
      return conn ? patch<Connection>(`/connections/${conn.id}`, { name: finalName, config }) : post<Connection>("/connections", { name: finalName, kind: info.kind, config });
    },
    {
      success: (c) => (c.status === "needs_setup" ? `${c.name} saved. A few details are still missing.` : `${c.name} saved. Now test it below.`),
      error: "Couldn't save",
      invalidate: [["connections"]],
      onSuccess: (c) => {
        setConn(c);
        // Secrets are write-only: clear the inputs so they show "Saved ✓".
        setValues((v) => {
          const next = { ...v };
          for (const f of info?.fields ?? []) if (f.secret) next[f.key] = "";
          return next;
        });
        setDirty(false);
        setTestResult(null);
        setSendResult(null);
      },
    },
  );

  const test = useConnectionTest(conn?.id ?? null, false, setTestResult);
  const send = useConnectionTest(conn?.id ?? null, true, setSendResult);

  const missing = info
    ? info.fields.filter((f) => {
        if (!f.required) return false;
        const v = values[f.key];
        if (f.secret) return !(typeof v === "string" && v.trim()) && !conn?.secrets_set.includes(f.key);
        return v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.some((x) => String(x).trim()));
      })
    : [];

  /* -------- Step 0: pick what to connect -------- */
  if (!info) {
    return (
      <Drawer open onClose={onClose} width="w-[640px]" title="What do you want to connect?">
        <p className="mb-5 text-[13.5px] text-ink-2">Pick a place where your agents should post or send messages. We&apos;ll walk you through it step by step.</p>
        {kindsLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[84px] rounded-xl" />
            ))}
          </div>
        ) : kindsError ? (
          <ErrorState error={kindsError} />
        ) : kinds.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted">No connection types are available on this server.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {kinds.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => setKind(k.kind)}
                className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/40 focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:outline-none"
              >
                <KindIcon kind={k.kind} icon={k.icon} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-ink">
                    {friendlyName(k.kind, k)}
                    {!k.auto_publish ? <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-medium text-muted">You paste it</span> : null}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-ink-2">{k.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Drawer>
    );
  }

  const friendly = friendlyName(info.kind, info);
  const steps = info.setup_steps ?? [];
  const sendWhat = SENDABLE[info.kind];
  const testReason = manageReason ?? (!conn ? "Save first, then you can test it" : dirty ? "Save your changes first" : null);

  /* -------- Step 1+: guide, form, save & test -------- */
  return (
    <Drawer
      open
      onClose={onClose}
      width="w-[640px]"
      title={
        <span className="flex items-center gap-3">
          {!conn ? (
            <button type="button" onClick={() => setKind(null)} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Back to the list">
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <KindIcon kind={info.kind} icon={info.icon} />
          <span className="min-w-0">
            <span className="block truncate">{conn ? conn.name : `Connect ${friendly}`}</span>
            <span className="block text-[12.5px] font-normal text-muted">{friendly}</span>
          </span>
        </span>
      }
      footer={
        <>
          {conn ? <StatusPill status={conn.status} className="mr-auto" /> : null}
          <Button onClick={onClose}>{conn && !dirty ? "Done" : "Close"}</Button>
        </>
      }
    >
      <div className="space-y-9 pb-4">
        <p className="text-[13.5px] leading-relaxed text-ink-2">{info.description}</p>

        {!info.auto_publish ? (
          <Banner tone="info" title="You'll post these yourself">
            {friendly} doesn&apos;t allow automatic posting here. Your agents prepare each post, and you copy it from the content page with one click.
          </Banner>
        ) : null}

        {steps.length ? (
          <DrawerSection title="Before you start" hint="Follow these steps. It usually takes a couple of minutes.">
            <ol className="space-y-4">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3.5">
                  <NumberCircle n={i + 1} />
                  <p className="min-w-0 pt-1 text-[13.5px] leading-relaxed text-ink">{step}</p>
                </li>
              ))}
            </ol>
          </DrawerSection>
        ) : null}

        <DrawerSection title="Your details" hint="Passwords and keys are stored encrypted and never shown again.">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!manageReason) save.mutate(undefined);
            }}
          >
            <Field label="Name" hint="A name you'll recognise, shown in your workflows.">
              <Input value={name} onChange={(e) => change(() => setName(e.target.value))} placeholder={friendly} />
            </Field>
            {info.fields.map((f) => (
              <ConfigInput key={f.key} field={f} value={values[f.key]} secretSet={Boolean(conn?.secrets_set.includes(f.key))} onChange={(v) => change(() => setValues((s) => ({ ...s, [f.key]: v })))} />
            ))}
            <button type="submit" hidden />
          </form>
        </DrawerSection>

        <DrawerSection title="Save and check it works" hint="Testing only checks the connection. Nothing is posted.">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="md" loading={save.isPending} disabledReason={manageReason ?? (conn && !dirty ? "Everything is saved" : null)} onClick={() => save.mutate(undefined)}>
              {conn ? (dirty ? "Save changes" : "Saved ✓") : "Save"}
            </Button>
            <Button size="md" icon={<Zap className="size-3.5" />} loading={test.isPending} disabledReason={testReason} onClick={() => test.mutate(undefined)}>
              Test connection
            </Button>
          </div>
          {missing.length ? <p className="text-[12.5px] text-warn">Still needed: {missing.map((f) => f.label).join(", ")}. You can save now and finish later.</p> : null}
          {testResult ? <ResultBox result={testResult} what="test" /> : null}
        </DrawerSection>

        {sendWhat ? (
          <DrawerSection
            title={sendWhat === "message" ? "Send a test message" : "Send a test post"}
            hint={
              sendWhat === "message"
                ? `We'll send one short test message to ${friendly} so you can see it arrive.`
                : `We'll send one real test post to ${friendly}. You can delete it afterwards.`
            }
          >
            <div>
              <Button size="md" icon={<Send className="size-3.5" />} loading={send.isPending} disabledReason={testReason} onClick={() => send.mutate(undefined)}>
                {sendWhat === "message" ? "Send a test message" : "Send a test post"}
              </Button>
            </div>
            {sendResult ? <ResultBox result={sendResult} what={sendWhat} /> : null}
          </DrawerSection>
        ) : null}
      </div>
    </Drawer>
  );
}

function ConfigInput({ field: f, value, secretSet, onChange }: { field: ConfigField; value: unknown; secretSet: boolean; onChange: (v: unknown) => void }) {
  const label = (
    <>
      {f.label}
      {f.required ? <span className="text-muted"> *</span> : null}
    </>
  );

  if (f.secret) {
    return (
      <Field label={label} hint={secretSet ? <span className="text-ok">Saved ✓, leave blank to keep</span> : (f.help ?? "Stored encrypted and never shown again.")}>
        <Input type="password" autoComplete="new-password" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={secretSet ? "••••••••" : f.placeholder} />
      </Field>
    );
  }

  switch (f.type) {
    case "boolean":
      return (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
          <div>
            <p className="text-[13px] font-medium text-ink">{f.label}</p>
            {f.help ? <p className="text-xs text-muted">{f.help}</p> : null}
          </div>
          <Toggle checked={Boolean(value)} onChange={onChange} label={f.label} />
        </div>
      );
    case "textarea":
      return (
        <Field label={label} hint={f.help}>
          <Textarea rows={4} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
        </Field>
      );
    case "number":
      return (
        <Field label={label} hint={f.help}>
          <Input type="number" min={f.min} max={f.max} value={value === null || value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
        </Field>
      );
    case "select":
      return (
        <Field label={label} hint={f.help}>
          <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            {!f.required ? <option value="">—</option> : null}
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field label={label} hint={f.help}>
          <div className="flex flex-wrap gap-1.5">
            {(f.options ?? []).map((o) => {
              const on = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(on ? selected.filter((x) => x !== o.value) : [...selected, o.value])}
                  className={cn("h-8 rounded-full border px-3 text-[12.5px] font-medium", on ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:border-line-strong")}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </Field>
      );
    }
    case "string_list": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field label={label} hint={f.help ?? "One per line."}>
          <Textarea rows={3} value={list.join("\n")} onChange={(e) => onChange(e.target.value.split("\n"))} placeholder={f.placeholder} />
        </Field>
      );
    }
    default:
      return (
        <Field label={label} hint={f.help}>
          <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
        </Field>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Connect your site                                                    */
/* ------------------------------------------------------------------ */

type SiteTab = "nextjs" | "widget" | "wordpress" | "rest";

function ConnectSite({ onSetup, manageReason }: { onSetup: (kind: ConnectionKind) => void; manageReason: string | null }) {
  const [tab, setTab] = useState<SiteTab>("nextjs");
  const [origin, setOrigin] = useState("https://YOUR-LAYERFLOW-DOMAIN");
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <Section
      className="mt-12"
      title="Connect your site"
      subtitle="Copy-ready snippets for your stack. Use an API key from API keys & SDK; the API base is this LayerFlow server."
    >
      <Card>
        <Tabs<SiteTab>
          className="px-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "nextjs", label: "Next.js" },
            { value: "widget", label: "Embed widget" },
            { value: "wordpress", label: "WordPress" },
            { value: "rest", label: "Any site / REST" },
          ]}
        />
        <div className="space-y-4 p-4 sm:p-5">
          {tab === "nextjs" ? <NextjsSnippets origin={origin} onSetup={() => onSetup("nextjs")} manageReason={manageReason} /> : null}
          {tab === "widget" ? <WidgetSnippets origin={origin} /> : null}
          {tab === "wordpress" ? <WordpressSnippets origin={origin} onSetup={onSetup} manageReason={manageReason} /> : null}
          {tab === "rest" ? <RestSnippets origin={origin} /> : null}
        </div>
      </Card>
    </Section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{n}</span>
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="pt-0.5 text-[13.5px] font-medium text-ink">{title}</p>
        {children}
      </div>
    </div>
  );
}

function NextjsSnippets({ origin, onSetup, manageReason }: { origin: string; onSetup: () => void; manageReason: string | null }) {
  const env = `# .env.local (and your hosting provider's environment settings)
LAYERFLOW_API_URL=${origin}
LAYERFLOW_API_KEY=lf_pk_xxxxxxxx           # scopes: content:read + datasets:read
LAYERFLOW_WEBHOOK_SECRET=the-same-secret-as-the-connection`;

  const lib = `// lib/layerflow.ts — server-only (reads the API key)
const API = (process.env.LAYERFLOW_API_URL || "").replace(/\\/$/, "");
const KEY = process.env.LAYERFLOW_API_KEY || "";

async function lf<T>(path: string): Promise<T> {
  const res = await fetch(\`\${API}/api/public/v1\${path}\`, {
    headers: { Authorization: \`Bearer \${KEY}\`, Accept: "application/json" },
    next: { revalidate: 300, tags: ["layerflow"] },
  });
  if (!res.ok) throw new Error(\`LayerFlow \${path} failed: \${res.status}\`);
  return res.json() as Promise<T>;
}

/** Published posts, newest first. */
export function getPosts(opts: { limit?: number; tag?: string } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 20) });
  if (opts.tag) q.set("tag", opts.tag);
  return lf<{ items: any[]; total: number }>(\`/content?\${q}\`);
}

/** One published post by slug, or null. */
export async function getPost(slug: string) {
  try {
    return await lf<any>(\`/content/\${encodeURIComponent(slug)}\`);
  } catch {
    return null;
  }
}

/** Records from a public dataset, e.g. getRecords("colleges", { sort: "nirf_rank:asc" }). */
export function getRecords(dataset: string, opts: { q?: string; limit?: number; sort?: string } = {}) {
  const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
  if (opts.q) q.set("q", opts.q);
  if (opts.sort) q.set("sort", opts.sort);
  return lf<{ items: any[]; total: number }>(\`/datasets/\${encodeURIComponent(dataset)}/records?\${q}\`);
}`;

  const route = `// app/api/layerflow/route.ts — LayerFlow calls this when content is published
import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

export async function POST(req: Request) {
  const secret = process.env.LAYERFLOW_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "LAYERFLOW_WEBHOOK_SECRET not set" }, { status: 500 });

  const raw = await req.text(); // verify the RAW body, before parsing
  if (!validSignature(raw, req.headers.get("x-layerflow-signature"), secret)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as { event: string; content?: { slug: string } };
  revalidatePath("/", "layout");
  if (event.content?.slug) revalidatePath(\`/news/\${event.content.slug}\`);
  return Response.json({ ok: true, event: event.event });
}`;

  return (
    <div className="space-y-6">
      <p className="text-[13px] text-ink-2">Content stays in LayerFlow. Your site fetches it with ISR caching, and LayerFlow pings the site the moment something is published. No rebuilds, no redeploys.</p>
      <Step n={1} title="Add the environment variables">
        <CodeBlock code={env} title=".env.local" />
      </Step>
      <Step n={2} title="Add the client: lib/layerflow.ts">
        <CodeBlock code={lib} title="lib/layerflow.ts" />
      </Step>
      <Step n={3} title="Add the webhook receiver">
        <CodeBlock code={route} title="app/api/layerflow/route.ts" />
      </Step>
      <Step n={4} title="Create a Next.js connection with the same secret">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<Plus className="size-3.5" />} disabledReason={manageReason} onClick={onSetup}>
            Set up Next.js connection
          </Button>
          <span className="text-[12.5px] text-muted">Webhook URL: https://your-site.com/api/layerflow</span>
        </div>
      </Step>
    </div>
  );
}

function WidgetSnippets({ origin }: { origin: string }) {
  const script = `<script src="${origin}/widget.js"
        data-key="lf_pk_…"
        data-dataset="colleges"
        data-title="Compare colleges"
        data-color="#2563eb"
        defer></script>`;
  const attrs: [string, string][] = [
    ["data-key", "API key with only the assistant:chat scope (it is visible in the page source)"],
    ["data-dataset", "Dataset slug to answer from — or use data-assistant"],
    ["data-assistant", "A comparison assistant agent id (uses its instructions and dataset)"],
    ["data-title", "Header text"],
    ["data-color", "Brand colour (hex)"],
    ["data-position", "right (default) or left for the floating bubble"],
  ];
  return (
    <div className="space-y-5">
      <p className="text-[13px] text-ink-2">One script tag adds a chat assistant that answers questions and compares records side by side. Works on plain HTML, WordPress, Webflow, Shopify and Next.js.</p>
      <CodeBlock code={script} title="HTML · before </body>" />
      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-[12.5px]">
          <tbody>
            {attrs.map(([k, v]) => (
              <tr key={k} className="border-b border-line last:border-0">
                <td className="w-[150px] px-3 py-2 align-top font-mono text-ink">{k}</td>
                <td className="px-3 py-2 text-ink-2">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] text-muted">
        Control it from the page: <code className="font-mono text-ink-2">window.LayerFlow.open()</code>, <code className="font-mono text-ink-2">.close()</code>,{" "}
        <code className="font-mono text-ink-2">.ask(&quot;Compare IIT Bombay and BITS Pilani&quot;)</code>.
      </p>
    </div>
  );
}

function WordpressSnippets({ origin, onSetup, manageReason }: { origin: string; onSetup: (k: ConnectionKind) => void; manageReason: string | null }) {
  const shortcodes = `[layerflow_assistant dataset="colleges"]
[layerflow_posts limit="5"]`;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-line p-4">
        <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Option A · fastest</p>
        <p className="mt-1 text-[14px] font-semibold text-ink">No plugin: application password</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[13px] text-ink-2">
          <li>In WordPress: Users → Profile → Application Passwords → name it “LayerFlow” → Add. Copy the password.</li>
          <li>Create a WordPress connection with the site URL, username and that password.</li>
          <li>Test it, then add it to your workflow&apos;s Auto Publisher.</li>
        </ol>
        <Button className="mt-4" variant="primary" icon={<Plus className="size-3.5" />} disabledReason={manageReason} onClick={() => onSetup("wordpress")}>
          Set up WordPress connection
        </Button>
      </div>
      <div className="rounded-xl border border-line p-4">
        <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Option B · more features</p>
        <p className="mt-1 text-[14px] font-semibold text-ink">LayerFlow Connector plugin</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-[13px] text-ink-2">
          <li>
            Zip <span className="font-mono text-[12px]">integrations/wordpress/layerflow-connector</span> → Plugins → Add New → Upload → Activate.
          </li>
          <li>
            Settings → LayerFlow: URL <span className="font-mono text-[12px] break-all">{origin}</span>, a server key (content:read + datasets:read) and an assistant key (assistant:chat only).
          </li>
          <li>
            Add a Webhook connection to <span className="font-mono text-[12px] break-all">https://your-blog.com/wp-json/layerflow/v1/publish</span> with the same secret.
          </li>
        </ol>
        <CodeBlock className="mt-3" code={shortcodes} title="Shortcodes" />
        <Button className="mt-3" icon={<Plus className="size-3.5" />} disabledReason={manageReason} onClick={() => onSetup("webhook")}>
          Add webhook connection
        </Button>
      </div>
    </div>
  );
}

function RestSnippets({ origin }: { origin: string }) {
  const base = `${origin}/api/public/v1`;
  const content = `curl "${base}/content?limit=10" \\
  -H "Authorization: Bearer lf_pk_…"`;
  const records = `curl "${base}/datasets/colleges/records?sort=nirf_rank:asc&limit=20" \\
  -H "Authorization: Bearer lf_pk_…"`;
  const chat = `curl -X POST "${base}/chat" \\
  -H "Authorization: Bearer lf_pk_…" \\
  -H "Content-Type: application/json" \\
  -d '{"dataset":"colleges","message":"IIT Delhi vs NIT Trichy on fees"}'`;
  const rss = `${base}/rss.xml?key=lf_pk_…`;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-2">Every endpoint is plain HTTPS + JSON with open CORS. Send the key as <code className="font-mono text-ink">Authorization: Bearer</code>.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <CodeBlock code={content} title="Published content · content:read" />
        <CodeBlock code={records} title="Dataset records · datasets:read" />
        <CodeBlock code={chat} title="Assistant · assistant:chat" />
        <CodeBlock code={rss} title="RSS 2.0 feed · content:read" />
      </div>
    </div>
  );
}
