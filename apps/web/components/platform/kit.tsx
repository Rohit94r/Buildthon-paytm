"use client";

// Shared building blocks for the platform pages: icons, category colours, status pills, copy helpers, markdown,
// permissions and small layout pieces. Keep pages simple by composing these.
import {
  Activity,
  BadgeCheck,
  BellRing,
  BookOpenText,
  Braces,
  Check,
  CircleDashed,
  Copy,
  Database,
  Feather,
  FileBarChart,
  Filter,
  GitCompareArrows,
  Globe,
  GraduationCap,
  Hash,
  Image as ImageIcon,
  Layers,
  Mail,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  Package,
  Radar,
  ScanSearch,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trophy,
  Triangle,
  Webhook,
  Linkedin,
  Twitter,
  PenTool,
  type LucideIcon,
  Loader2,
  UserCheck,
  Workflow,
  Link as LinkIcon,
  FileText,
  Eye,
  KeyRound,
  Scale,
  Images,
  Camera,
  Languages,
  Mail as MailIcon,
  Table,
  Users,
  Briefcase,
  CalendarDays,
  Star,
  MapPin,
  ListChecks,
  HelpCircle,
  Tag,
  Target,
  Sheet,
  Bell,
  Bot,
  Network,
  FileSearch,
  Building2,
  Heart,
  Gauge,
  Code,
  Unlink,
  ShoppingCart,
  PenLine,
  Megaphone,
  Quote,
  Rss,
  Trophy as TrophyIcon,
  AtSign,
  BookOpen,
  CalendarRange,
  CircleHelp,
  Columns3,
  Contact,
  DatabaseZap,
  Flame,
  ImagePlus,
  LifeBuoy,
  ListCollapse,
  MailPlus,
  MessageSquareQuote,
  ScanText,
  SearchCheck,
  Smile,
  TrendingUp,
  Wand2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { useMe } from "@/lib/hooks";
import type { Permission } from "@/lib/platform-ops-types";
import type { AgentCategory, AgentKind, AgentType } from "@/lib/platform-types";

/* ---------------- Icons ---------------- */
const ICONS: Record<string, LucideIcon> = {
  Activity,
  BadgeCheck,
  BellRing,
  BookOpenText,
  Braces,
  Database,
  Feather,
  FileBarChart,
  Filter,
  GitCompareArrows,
  Globe,
  GraduationCap,
  Hash,
  Image: ImageIcon,
  Layers,
  Mail,
  MessageCircle,
  MessagesSquare,
  Newspaper,
  Package,
  Radar,
  ScanSearch,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trophy,
  Triangle,
  Webhook,
  Linkedin,
  Twitter,
  PenTool,
  UserCheck,
  Workflow,
  Send2: Send,
  Link: LinkIcon,
  FileText,
  Eye,
  KeyRound,
  Scale,
  Images,
  Camera,
  Languages,
  MailIcon,
  Table,
  Users,
  Briefcase,
  CalendarDays,
  Star,
  MapPin,
  ListChecks,
  HelpCircle,
  Tag,
  Target,
  Sheet,
  Bell,
  Bot,
  Network,
  FileSearch,
  Building2,
  Heart,
  Gauge,
  Code,
  Unlink,
  ShoppingCart,
  PenLine,
  Megaphone,
  Quote,
  Rss,
  Medal: TrophyIcon,
  AtSign,
  BookOpen,
  CalendarRange,
  CircleHelp,
  Columns3,
  Contact,
  DatabaseZap,
  Flame,
  ImagePlus,
  LifeBuoy,
  ListCollapse,
  MailPlus,
  MessageSquareQuote,
  ScanText,
  SearchCheck,
  Smile,
  TrendingUp,
  Wand2,
};

export function iconFor(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Sparkles;
}

export const KIND_ICON: Record<string, string> = {
  web_scraper: "Globe",
  news_monitor: "Radar",
  persona_rewriter: "Feather",
  multi_format: "Layers",
  seo_optimizer: "Search",
  quality_gate: "ShieldCheck",
  data_transform: "Filter",
  auto_publisher: "Send",
  dataset_builder: "Database",
  comparison_assistant: "MessagesSquare",
  custom_llm: "Sparkles",
  researcher: "BookOpenText",
  fact_checker: "BadgeCheck",
  site_auditor: "ScanSearch",
  image_finder: "Image",
  change_detector: "GitCompareArrows",
  http_action: "Webhook",
  notifier: "BellRing",
  report_builder: "FileBarChart",
  link_collector: "Link",
  document_reader: "FileText",
  page_watcher: "Eye",
  keyword_researcher: "KeyRound",
  comparer: "Scale",
  serpapi_search: "ScanSearch",
  you_research: "BookOpenCheck",
  approval: "UserCheck",
};

export const KIND_CATEGORY: Record<string, AgentCategory | "approval"> = {
  web_scraper: "collect",
  news_monitor: "collect",
  researcher: "collect",
  image_finder: "collect",
  persona_rewriter: "create",
  multi_format: "create",
  custom_llm: "create",
  report_builder: "create",
  seo_optimizer: "quality",
  quality_gate: "quality",
  fact_checker: "quality",
  site_auditor: "quality",
  auto_publisher: "deliver",
  http_action: "deliver",
  notifier: "deliver",
  dataset_builder: "data",
  data_transform: "data",
  change_detector: "data",
  comparison_assistant: "assist",
  link_collector: "collect",
  document_reader: "collect",
  page_watcher: "data",
  keyword_researcher: "quality",
  comparer: "data",
  serpapi_search: "collect",
  you_research: "collect",
  approval: "approval",
};

export const CATEGORY_META: Record<AgentCategory | "approval", { label: string; color: string; hint: string }> = {
  collect: { label: "Collect", color: "var(--cat-collect)", hint: "Bring data in: scrape, monitor, research" },
  create: { label: "Create", color: "var(--cat-create)", hint: "Write, rewrite and repurpose" },
  quality: { label: "Quality", color: "var(--cat-quality)", hint: "Check, optimise and gate" },
  deliver: { label: "Deliver", color: "var(--cat-deliver)", hint: "Publish, notify and call APIs" },
  data: { label: "Data", color: "var(--cat-data)", hint: "Clean, sort and store records" },
  assist: { label: "Assist", color: "var(--cat-assist)", hint: "Answer questions in real time" },
  approval: { label: "Approval", color: "var(--cat-approval)", hint: "Pause for a human" },
};

export function categoryOf(kind: string | null | undefined, types?: AgentType[]): AgentCategory | "approval" {
  if (!kind) return "create";
  return types?.find((t) => t.kind === kind)?.category ?? KIND_CATEGORY[kind] ?? "create";
}

/** Rounded square tile with the agent's icon, tinted by its category colour. */
export function AgentGlyph({ kind, icon, category, size = "md", className }: { kind?: AgentKind | string | null; icon?: string | null; category?: AgentCategory | "approval"; size?: "sm" | "md" | "lg"; className?: string }) {
  const cat = category ?? categoryOf(kind ?? undefined);
  const Icon = iconFor(icon ?? KIND_ICON[kind ?? ""] ?? null);
  const color = CATEGORY_META[cat]?.color ?? "var(--muted)";
  const dims = { sm: "size-7 rounded-lg [&_svg]:size-3.5", md: "size-9 rounded-xl [&_svg]:size-4", lg: "size-12 rounded-2xl [&_svg]:size-5.5" }[size];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", dims, className)}
      style={{ color, background: `color-mix(in oklab, ${color} 13%, var(--surface))`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 22%, transparent)` }}
      aria-hidden
    >
      <Icon />
    </span>
  );
}

export function CategoryTag({ category }: { category: AgentCategory | "approval" }) {
  const m = CATEGORY_META[category];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-2">
      <span className="size-1.5 rounded-full" style={{ background: m.color }} aria-hidden />
      {m.label}
    </span>
  );
}

/* ---------------- Status ---------------- */
type StatusTone = "ok" | "bad" | "warn" | "info" | "neutral" | "live";
const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "live" },
  awaiting_approval: { label: "Needs approval", tone: "warn" },
  succeeded: { label: "Succeeded", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  pending: { label: "Pending", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  draft: { label: "Draft", tone: "warn" },
  approved: { label: "Approved", tone: "info" },
  published: { label: "Published", tone: "ok" },
  rejected: { label: "Rejected", tone: "neutral" },
  active: { label: "Active", tone: "ok" },
  paused: { label: "Paused", tone: "warn" },
  disabled: { label: "Disabled", tone: "neutral" },
  connected: { label: "Connected", tone: "ok" },
  needs_setup: { label: "Needs setup", tone: "warn" },
  error: { label: "Error", tone: "bad" },
  manual: { label: "Manual post", tone: "info" },
  invited: { label: "Invited", tone: "info" },
  suspended: { label: "Suspended", tone: "bad" },
};

const DOT: Record<StatusTone, string> = { ok: "bg-ok", bad: "bg-bad", warn: "bg-warn", info: "bg-info", neutral: "bg-muted", live: "bg-accent" };
const PILL: Record<StatusTone, string> = {
  ok: "text-ok bg-ok-soft",
  bad: "text-bad bg-bad-soft",
  warn: "text-warn bg-warn-soft",
  info: "text-info bg-info-soft",
  neutral: "text-ink-2 bg-surface-2",
  live: "text-accent bg-accent-soft",
};

export function statusTone(status: string): StatusTone {
  return STATUS[status]?.tone ?? "neutral";
}

export function Dot({ tone, live, className }: { tone: StatusTone; live?: boolean; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", DOT[tone], live && "live-dot", className)} aria-hidden />;
}

export function StatusPill({ status, label, className }: { status: string; label?: string; className?: string }) {
  const m = STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" as StatusTone };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11.5px] leading-none font-medium whitespace-nowrap", PILL[m.tone], className)}>
      {m.tone === "live" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Dot tone={m.tone} className="size-1.5" />}
      {label ?? m.label}
    </span>
  );
}

/* ---------------- Copy ---------------- */
export function useCopy(): [string | null, (text: string, key?: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key = "default") => {
    const done = () => {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  };
  return [copied, copy];
}

function fallbackCopy(text: string, done: () => void) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand("copy");
    done();
  } finally {
    el.remove();
  }
}

export function CopyButton({ text, label = "Copy", className, size = "xs" }: { text: string; label?: string; className?: string; size?: "xs" | "sm" }) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface font-medium text-ink-2 shadow-sm transition-colors hover:border-line-strong hover:text-ink",
        size === "xs" ? "h-7 px-2 text-xs" : "h-8 px-2.5 text-[13px]",
        className,
      )}
      aria-label={label}
    >
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function CodeBlock({ code, lang, className, title }: { code: string; lang?: string; className?: string; title?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-surface-2", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted">{title ?? lang ?? "code"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CopyField({ value, label, mono = true }: { value: string; label?: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2 py-1 pr-1 pl-3">
      {label ? <span className="shrink-0 text-xs text-muted">{label}</span> : null}
      <span className={cn("min-w-0 flex-1 truncate text-[12.5px] text-ink", mono && "font-mono")} title={value}>
        {value}
      </span>
      <CopyButton text={value} />
    </div>
  );
}

/* ---------------- Markdown (small, safe: builds React nodes, no HTML injection) ---------------- */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${keyBase}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = mm?.[2] ?? "#";
      out.push(
        <a key={k} href={/^(https?:|\/|#|mailto:)/.test(href) ? href : "#"} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
          {mm?.[1]}
        </a>,
      );
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className, serif }: { text: string; className?: string; serif?: boolean }) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = Math.min(3, h[1].length);
      const Tag = (["h1", "h2", "h3"] as const)[lvl - 1];
      blocks.push(<Tag key={k++}>{inline(h[2], `h${k}`)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      blocks.push(
        <ul key={k++}>
          {items.map((t, j) => (
            <li key={j}>{inline(t, `u${k}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(
        <ol key={k++}>
          {items.map((t, j) => (
            <li key={j}>{inline(t, `o${k}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) items.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k++}>{inline(items.join(" "), `q${k}`)}</blockquote>);
      continue;
    }
    if (line.trim().startsWith("|") && lines[i + 1]?.includes("---")) {
      const rows: string[][] = [];
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push(
        <table key={k++}>
          <thead>
            <tr>
              {head.map((c, j) => (
                <th key={j}>{inline(c, `th${k}-${j}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, j) => (
                  <td key={j}>{inline(c, `td${k}-${ri}-${j}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*•]\s|\s*\d+[.)]\s|>|\|)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(<p key={k++}>{inline(para.join(" "), `p${k}`)}</p>);
  }
  return <div className={cn("md", serif && "serif", className)}>{blocks}</div>;
}

/* ---------------- Permissions ---------------- */
export function usePermissions() {
  const me = useMe();
  const perms = me.data?.permissions;
  const can = (p: Permission) => (perms ? perms.includes(p) : me.data?.user.role !== "reviewer" || p === "view");
  const readOnly = Boolean(me.data?.support_access);
  return {
    can: (p: Permission) => !readOnly && can(p),
    reason: (p: Permission) =>
      readOnly ? "Support access is read-only" : can(p) ? null : `Your role (${me.data?.role ?? me.data?.user.role ?? "viewer"}) can't do this`,
    role: me.data?.role ?? null,
    readOnly,
  };
}

/* ---------------- Layout bits ---------------- */
export function Section({ title, subtitle, actions, children, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "bad" | "warn" | "accent"; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[12px] font-medium text-muted">{label}</p>
        {icon ? <span className="text-muted [&_svg]:size-3.5">{icon}</span> : null}
      </div>
      <p className={cn("mt-1.5 text-[24px] leading-none font-semibold tracking-tight tabular", tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "text-ink")}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 truncate text-[12px] text-ink-2">{hint}</p> : null}
    </div>
  );
}

export function FilterChips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
            value === o.value ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
          )}
        >
          {o.label}
          {o.count !== undefined ? <span className={cn("tabular text-[11px]", value === o.value ? "opacity-70" : "text-muted")}>{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={cn("relative block", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-lg border border-line-strong bg-surface pr-3 pl-8 text-[13px] text-ink shadow-sm placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none"
      />
    </label>
  );
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-muted shadow-sm [&_svg]:size-5">{icon ?? <CircleDashed />}</div>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body ? <div className="mt-1 max-w-md text-[13px] text-ink-2">{body}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function KeyValue({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]", className)}>
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-muted">{it.label}</dt>
          <dd className="min-w-0 truncate text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function formatEvery(min: number | null | undefined): string {
  if (!min) return "Manual";
  if (min % 10080 === 0) return min === 10080 ? "Weekly" : `Every ${min / 10080} weeks`;
  if (min % 1440 === 0) return min === 1440 ? "Daily" : `Every ${min / 1440} days`;
  if (min % 60 === 0) return min === 60 ? "Hourly" : `Every ${min / 60} h`;
  return `Every ${min} min`;
}

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}
