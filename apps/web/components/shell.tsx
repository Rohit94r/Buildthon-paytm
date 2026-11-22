"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  Bot,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronsUpDown,
  ClipboardCheck,
  Database,
  FileText,
  HeartPulse,
  Home,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  MessagesSquare,
  Moon,
  Newspaper,
  PenLine,
  Play,
  Plug,
  Plus,
  Receipt,
  ScrollText,
  Search,
  Settings,
  Share2,
  Shield,
  Store,
  Sun,
  TrendingUp,
  Users,
  Webhook,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { get, post } from "@/lib/api";
import { DEMO_FORCED, exitDemo, isDemoMode } from "@/lib/demo/mode";
import { ago, titleCase } from "@/lib/format";
import { useHealth } from "@/lib/hooks";
import type { NotificationItem } from "@/lib/platform-ops-types";
import type { Me } from "@/lib/types";
import { useSwitchWorkspace, useWorkspace } from "@/lib/workspace";
import { CommandPalette } from "./command-palette";
import { Kbd, cn } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: string[];
}
interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  /** Rarely used groups start collapsed. */
  collapsed?: boolean;
}
type NavEntry = NavItem | NavGroup;
const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

function buildNav(opts: { newsroom: boolean; admin: boolean }): NavEntry[] {
  const nav: NavEntry[] = [
    { href: "/", label: "Home", icon: Home },
    { href: "/livedesk", label: "LiveDesk", icon: Zap },
    {
      key: "agents",
      label: "Agents",
      icon: Bot,
      items: [
        { href: "/catalogue", label: "Catalogue", icon: Store },
        { href: "/agents", label: "My agents", icon: Bot },
        { href: "/activity", label: "Activity", icon: Activity },
      ],
    },
    {
      key: "workflows",
      label: "Workflows",
      icon: Workflow,
      items: [
        { href: "/pipelines", label: "Workflows", icon: Workflow },
        { href: "/runs", label: "Runs", icon: Play },
      ],
    },
    { href: "/content", label: "Content", icon: FileText },
    {
      key: "data",
      label: "Data",
      icon: Database,
      items: [
        { href: "/datasets", label: "Datasets", icon: Database },
        { href: "/assistant", label: "Assistant", icon: MessagesSquare },
      ],
    },
    {
      key: "integrations",
      label: "Integrations",
      icon: Plug,
      collapsed: true,
      items: [
        { href: "/connections", label: "Connections", icon: Plug },
        { href: "/developers", label: "API keys & SDK", icon: KeyRound },
        { href: "/webhooks", label: "Webhooks", icon: Webhook },
      ],
    },
  ];
  if (opts.newsroom)
    nav.push({
      key: "newsroom",
      label: "Newsroom",
      icon: Newspaper,
      items: [
        { href: "/newsroom", label: "Overview", icon: LayoutDashboard },
        { href: "/news", label: "News Feed", icon: Newspaper },
        { href: "/studio", label: "Studio", icon: PenLine },
        { href: "/review", label: "Review", icon: ClipboardCheck },
        { href: "/seo", label: "SEO", icon: TrendingUp },
        { href: "/calendar", label: "Calendar", icon: CalendarDays },
        { href: "/social", label: "Social", icon: Share2 },
        { href: "/settings", label: "Newsroom settings", icon: Settings },
      ],
    });
  nav.push({
    key: "settings",
    label: "Settings",
    icon: Settings,
    collapsed: true,
    items: [
      { href: "/settings/workspace", label: "Workspace", icon: Settings, match: opts.newsroom ? [] : ["/settings"] },
      { href: "/settings/members", label: "Members", icon: Users },
      { href: "/settings/usage", label: "Usage & plan", icon: Receipt },
      { href: "/settings/audit", label: "Audit log", icon: ScrollText },
    ],
  });
  if (opts.admin)
    nav.push({
      key: "platform",
      label: "Platform",
      icon: Shield,
      items: [
        { href: "/platform", label: "Overview", icon: LayoutGrid },
        { href: "/clients", label: "Clients", icon: Building2 },
        { href: "/platform/health", label: "Health", icon: HeartPulse },
      ],
    });
  return nav;
}

function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("lf-theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
    setDark(next);
  };
  return [dark, toggle];
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/* ---------------- Workspace switcher ---------------- */
function WorkspaceSwitcher({ me }: { me: Me }) {
  const ws = useWorkspace();
  const switchTo = useSwitchWorkspace();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const current = ws.workspaces.find((w) => w.slug === ws.slug);
  const role = me.role ?? current?.role ?? me.user.role;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2 text-left shadow-sm transition-colors hover:border-line-strong"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white" style={{ background: ws.brand }}>
          {ws.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight font-semibold text-ink">{ws.name}</span>
          <span className="block truncate text-[11.5px] leading-tight text-muted">{titleCase(role ?? "member")}{me.support_access ? " · support access" : ""}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted" />
      </button>
      {open ? (
        <div className="animate-in absolute top-full right-0 left-0 z-50 mt-1.5 rounded-xl border border-line bg-surface p-1 shadow-lg" role="listbox">
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted">Workspaces</p>
          <div className="max-h-72 overflow-y-auto">
            {ws.workspaces.map((w) => (
              <button
                key={w.slug}
                type="button"
                role="option"
                aria-selected={w.slug === ws.slug}
                onClick={() => {
                  setOpen(false);
                  if (w.slug !== ws.slug) switchTo(w.slug);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-surface-2"
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: w.brand_color }} />
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.role ? <span className="text-[11px] text-muted">{titleCase(w.role)}</span> : null}
                {w.slug === ws.slug ? <Check className="size-3.5 text-accent" /> : null}
              </button>
            ))}
          </div>
          {ws.isPlatformAdmin ? (
            <>
              <div className="my-1 h-px bg-line" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push("/clients?new=1");
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                <Plus className="size-3.5" /> New client workspace
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Sidebar ---------------- */
function Sidebar({ nav, pathname, onNavigate }: { nav: NavEntry[]; pathname: string; onNavigate?: () => void }) {
  const allHrefs = useMemo(() => nav.flatMap((e) => (isGroup(e) ? e.items.map((i) => i.href) : [e.href])), [nav]);
  const isActive = (item: NavItem) => {
    if (item.href === "/") return pathname === "/";
    if (pathname === item.href) return true;
    if (item.match?.some((m) => pathname === m)) return true;
    if (!pathname.startsWith(`${item.href}/`)) return false;
    // a more specific nav entry wins (e.g. /settings/members over /settings)
    return !allHrefs.some((h) => h !== item.href && h.startsWith(`${item.href}/`) && (pathname === h || pathname.startsWith(`${h}/`)));
  };
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      setOpenGroups(JSON.parse(localStorage.getItem("lf-nav") ?? "{}"));
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = (key: string, current: boolean) => {
    const next = { ...openGroups, [key]: !current };
    setOpenGroups(next);
    try {
      localStorage.setItem("lf-nav", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const link = (item: NavItem, nested: boolean) => {
    const active = isActive(item);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors",
          nested && "pl-[34px]",
          active ? "bg-surface font-medium text-ink shadow-sm ring-1 ring-line" : "text-ink-2 hover:bg-surface-2/80 hover:text-ink",
        )}
      >
        {!nested ? <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-muted group-hover:text-ink-2")} aria-hidden /> : null}
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };
  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3" aria-label="Main">
      {nav.map((e) => {
        if (!isGroup(e)) return link(e, false);
        const containsActive = e.items.some(isActive);
        const open = containsActive || (openGroups[e.key] ?? !e.collapsed);
        const Icon = e.icon;
        return (
          <div key={e.key} className="pt-0.5">
            <button
              type="button"
              onClick={() => toggle(e.key, open)}
              aria-expanded={open}
              className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] text-ink-2 transition-colors hover:bg-surface-2/80 hover:text-ink"
            >
              <Icon className={cn("size-4 shrink-0", containsActive ? "text-accent" : "text-muted group-hover:text-ink-2")} aria-hidden />
              <span className="flex-1 truncate text-left">{e.label}</span>
              <ChevronDown className={cn("size-3.5 text-muted transition-transform", !open && "-rotate-90")} aria-hidden />
            </button>
            {open ? <div className="relative mt-0.5 space-y-0.5 before:absolute before:top-1 before:bottom-1 before:left-[17px] before:w-px before:bg-line">{e.items.map((i) => link(i, true))}</div> : null}
          </div>
        );
      })}
    </nav>
  );
}

function ModelStatus() {
  const { data, isError } = useHealth();
  const model = data?.checks.model;
  const ok = !isError && model?.status === "ok";
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-muted" title={model?.detail ?? (isError ? "Health endpoint unreachable" : undefined)}>
      <span className={cn("size-1.5 rounded-full", ok ? "bg-ok" : model ? "bg-warn" : "bg-muted")} />
      <span className="truncate">{model ? `${model.provider} · ${ok ? "model ready" : model.status}` : isError ? "Model status unknown" : "Checking model…"}</span>
    </div>
  );
}

/* ---------------- Notifications ---------------- */
function NotificationBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => get<{ items: NotificationItem[]; unread: number }>("/notifications"),
    refetchInterval: 15_000,
    retry: false,
  });
  const unread = q.data?.unread ?? 0;
  const markAll = async () => {
    try {
      const r = await post<{ items: NotificationItem[]; unread: number }>("/notifications/read-all");
      qc.setQueryData(["notifications"], r);
    } catch {
      /* ignore */
    }
  };
  const tone: Record<NotificationItem["kind"], string> = { approval_needed: "bg-warn", run_failed: "bg-bad", quota: "bg-warn", connection_error: "bg-bad", info: "bg-info" };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
        <Bell className="size-4" />
        {unread ? <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] leading-4 font-semibold text-white tabular">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="animate-in absolute right-0 z-50 mt-1.5 w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-[13px] font-semibold text-ink">Notifications</p>
            <button type="button" onClick={markAll} disabled={!unread} className="text-xs text-accent hover:underline disabled:text-muted disabled:no-underline">
              Mark all read
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {q.isPending ? <p className="px-4 py-6 text-center text-[13px] text-muted">Loading…</p> : null}
            {q.isError ? <p className="px-4 py-6 text-center text-[13px] text-muted">Notifications are unavailable.</p> : null}
            {q.data && !q.data.items.length ? <p className="px-4 py-8 text-center text-[13px] text-muted">You&apos;re all caught up.</p> : null}
            {q.data?.items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (n.link) router.push(n.link);
                }}
                className="flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface-2"
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-line-strong" : tone[n.kind])} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13px]", n.read ? "text-ink-2" : "font-medium text-ink")}>{n.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>
                  <span className="mt-1 block text-[11px] text-muted">{ago(n.at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const qc = useQueryClient();
  const demo = isDemoMode();
  const logout = async () => {
    if (demo) {
      if (DEMO_FORCED) return;
      exitDemo();
      return;
    }
    try {
      await post("/auth/logout");
    } finally {
      qc.clear();
      window.location.href = "/login";
    }
  };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-2" aria-label="Account">
        <span className="flex size-7 items-center justify-center rounded-full bg-ink text-[11.5px] font-semibold text-bg">{(me.user.name || me.user.email)[0]?.toUpperCase()}</span>
      </button>
      {open ? (
        <div role="menu" className="animate-in absolute right-0 z-50 mt-1.5 w-60 rounded-xl border border-line bg-surface p-1 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate text-[13px] font-medium text-ink">{me.user.name}</p>
            <p className="truncate text-xs text-muted">{me.user.email}</p>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link role="menuitem" href="/settings/workspace" className="block rounded-lg px-3 py-1.5 text-[13px] text-ink hover:bg-surface-2" onClick={() => setOpen(false)}>
            Workspace settings
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={logout}
            disabled={demo && DEMO_FORCED}
            title={demo && DEMO_FORCED ? "This is a demo build" : undefined}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            <LogOut className="size-3.5" /> {demo ? "Exit demo" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DemoBanner() {
  return (
    <div className="flex h-9 items-center justify-center gap-3 border-b border-line bg-[#0e1116] px-4 text-[12.5px] text-white dark:bg-surface-2 dark:text-ink">
      <span className="inline-flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-[#4ade80]" />
        <strong className="font-semibold whitespace-nowrap">Demo mode</strong>
        <span className="hidden opacity-70 sm:inline">· sample data · nothing is saved</span>
      </span>
      {DEMO_FORCED ? null : (
        <button type="button" onClick={exitDemo} className="whitespace-nowrap rounded-md border border-current/25 px-2 py-0.5 text-[11.5px] font-medium hover:bg-white/10">
          Exit demo
        </button>
      )}
    </div>
  );
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const [dark, toggleTheme] = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [demo, setDemo] = useState(false);
  const ws = useWorkspace();
  useEffect(() => setDemo(isDemoMode()), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setMobileNav(false), [pathname]);
  const nav = useMemo(() => buildNav({ newsroom: ws.has("newsroom"), admin: ws.isPlatformAdmin }), [ws]);

  const sidebarInner = (
    <>
      <div className="flex items-center px-4 pt-4 pb-3">
        <Link href="/" aria-label="ANETAZO home" className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {/* White wordmark on its dark plate — keeps the mark legible in both themes. */}
          <img
            src="/brand/anetazo-logo.png"
            alt="ANETAZO"
            width={600}
            height={169}
            className="h-7 w-auto rounded-md"
          />
        </Link>
      </div>
      <div className="px-3 pb-1">
        <WorkspaceSwitcher me={me} />
      </div>
      <Sidebar nav={nav} pathname={pathname} onNavigate={() => setMobileNav(false)} />
      <div className="border-t border-line px-4 py-3">
        <ModelStatus />
      </div>
    </>
  );

  return (
    <div className="lf-accent flex min-h-screen flex-col" style={{ "--brand": ws.brand } as CSSProperties}>
      {demo ? <DemoBanner /> : null}
      {me.support_access ? (
        <div className="flex h-8 items-center justify-center gap-2 bg-warn-soft px-4 text-[12.5px] text-warn">
          <Shield className="size-3.5" /> Support access · read-only. Your visit is recorded in this workspace&apos;s audit log.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <aside className={cn("sticky hidden w-[248px] shrink-0 flex-col border-r border-line bg-bg md:flex", demo ? "top-9 h-[calc(100vh-36px)]" : "top-0 h-screen")}>{sidebarInner}</aside>
        {mobileNav ? (
          <div className="fixed inset-0 z-[75] md:hidden" onMouseDown={(e) => e.target === e.currentTarget && setMobileNav(false)}>
            <div className="absolute inset-0 bg-black/30" onClick={() => setMobileNav(false)} />
            <aside className="animate-in absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-line bg-bg shadow-lg">
              <button type="button" className="absolute top-3 right-3 rounded-lg p-1.5 text-muted hover:bg-surface-2" onClick={() => setMobileNav(false)} aria-label="Close menu">
                <X className="size-4" />
              </button>
              {sidebarInner}
            </aside>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className={cn("sticky z-40 flex h-14 items-center gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur-md lg:px-8", demo ? "top-9" : "top-0")}>
            <button type="button" onClick={() => setMobileNav(true)} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 md:hidden" aria-label="Open menu">
              <Menu className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-muted shadow-sm hover:border-line-strong"
              aria-label="Search (Ctrl+K)"
            >
              <Search className="size-3.5" />
              <span className="flex-1 truncate text-left">Jump to…</span>
              <Kbd>⌘K</Kbd>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell />
              <button type="button" onClick={toggleTheme} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title="Toggle theme">
                {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
              <UserMenu me={me} />
            </div>
          </header>
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
