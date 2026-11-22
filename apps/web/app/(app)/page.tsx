"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Camera, CheckCircle2, Circle, Eye, Flame, Globe, HelpCircle, Lock, PenLine, Scale, Send, ThumbsUp, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ContentThumb } from "@/components/platform/image-gallery";
import { iconFor, usePermissions } from "@/components/platform/kit";
import { QuickStartDialog, type QuickTask } from "@/components/platform/quick-start";
import { Button, Card, ErrorState, Skeleton, cn } from "@/components/ui";
import { get, post } from "@/lib/api";
import { ago, num } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { Achievement, WorkspaceProgress } from "@/lib/platform-ops-types";
import type { ContentItem, Paged } from "@/lib/platform-types";
import { useWorkspace } from "@/lib/workspace";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const TASKS: (QuickTask & { icon: typeof Globe; blurb: string; color: string; href?: string })[] = [
  {
    id: "collect",
    title: "Collect data from a website",
    blurb: "Turn any list on a site into a clean table",
    icon: Globe,
    color: "var(--cat-collect)",
    keys: ["smart_scraper", "table_extractor", "url_collector"],
    url: { label: "Which website?", placeholder: "https://www.example.com/products", required: true },
    ask: { label: "What do you want from it?", placeholder: "product name, price, rating", hint: "Plain words, separated by commas." },
  },
  {
    id: "images",
    title: "Find pictures",
    blurb: "Free-to-use images with credits",
    icon: Camera,
    color: "var(--cat-assist)",
    keys: ["open_image_finder", "image_scraper"],
    url: { label: "A page to take pictures from", placeholder: "https://… (or leave empty to search free libraries)" },
    ask: { label: "What should the pictures show?", placeholder: "students on a college campus in India" },
  },
  {
    id: "write",
    title: "Write posts for me",
    blurb: "Articles, LinkedIn, X and Instagram",
    icon: PenLine,
    color: "var(--cat-create)",
    keys: ["content_writer", "multiformat_creator", "social_caption_writer"],
    url: { label: "A link to write about", placeholder: "https://… (optional)" },
    ask: { label: "What should it write about?", placeholder: "This week's biggest IPOs, in a friendly tone for beginners" },
  },
  {
    id: "watch",
    title: "Watch a page for changes",
    blurb: "Get told when a price or text changes",
    icon: Eye,
    color: "var(--cat-data)",
    keys: ["page_watcher", "change_detector"],
    url: { label: "Which page should it watch?", placeholder: "https://www.example.com/product/phone-x", required: true },
    ask: { label: "What are you waiting for?", placeholder: "price drops, or the word 'admissions open'" },
  },
  {
    id: "compare",
    title: "Compare things",
    blurb: "Side-by-side tables with a winner",
    icon: Scale,
    color: "var(--cat-quality)",
    keys: ["comparison_builder", "comparison_assistant"],
    url: { label: "Where are the things listed?", placeholder: "https://… (optional)" },
    ask: { label: "What do you want to compare?", placeholder: "iPhone 16 vs Pixel 9 vs Galaxy S25 on price and battery" },
  },
  {
    id: "publish",
    title: "Publish to my website",
    blurb: "Connect your site, blog or channels",
    icon: Send,
    color: "var(--cat-deliver)",
    keys: [],
    ask: { label: "", placeholder: "" },
    href: "/connections",
  },
];

/* ---------------- Level ring ---------------- */
function Ring({ value, size = 76, children }: { value: number; size?: number; children: ReactNode }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={7} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={7} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

function PointsPopover({ rules }: { rules: WorkspaceProgress["xp_rules"] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink" aria-expanded={open}>
        <HelpCircle className="size-3.5" /> How points work
      </button>
      {open ? (
        <div className="animate-in absolute top-full left-0 z-30 mt-2 w-72 rounded-xl border border-line bg-surface p-4 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink">How you earn points</p>
            <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-ink" aria-label="Close">
              <X className="size-3.5" />
            </button>
          </div>
          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li key={r.action} className="flex items-start justify-between gap-3 text-[12.5px]">
                <span className="text-ink-2">{r.action}</span>
                <span className="shrink-0 rounded-full bg-accent-soft px-1.5 font-semibold text-accent tabular">+{r.points}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-muted">Points only come from real work your agents and team do.</p>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Today's wins ---------------- */
function Burst() {
  const dots = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return { dx: `${Math.cos(a) * 28}px`, dy: `${Math.sin(a) * 28}px`, c: ["var(--cat-collect)", "var(--cat-assist)", "var(--cat-quality)", "var(--cat-deliver)"][i % 4] };
  });
  return (
    <span className="pointer-events-none absolute top-1/2 left-1/2" aria-hidden>
      {dots.map((d, i) => (
        <span key={i} className="burst-dot" style={{ background: d.c, ["--dx" as string]: d.dx, ["--dy" as string]: d.dy }} />
      ))}
    </span>
  );
}

function Win({ label, value }: { label: string; value: number }) {
  return (
    <div className="relative rounded-xl bg-surface-2/70 px-3 py-3 text-center">
      {value > 0 ? <Burst /> : null}
      <p className={cn("text-[24px] leading-none font-semibold tracking-tight text-ink tabular", value > 0 && "animate-pop")}>{num(value)}</p>
      <p className="mt-1.5 text-[12px] text-muted">{label}</p>
    </div>
  );
}

/* ---------------- Achievements ---------------- */
function Badge({ a, next }: { a: Achievement; next?: boolean }) {
  const Icon = iconFor(a.icon);
  return (
    <div className={cn("flex w-[150px] shrink-0 flex-col items-center rounded-xl border p-3 text-center", a.unlocked ? "glow-ok border-warn/40 bg-warn-soft/50" : next ? "border-accent/40 bg-surface" : "border-line bg-surface opacity-70")} title={a.description}>
      <span className={cn("flex size-10 items-center justify-center rounded-full", a.unlocked ? "bg-warn text-white" : "bg-surface-2 text-muted")}>{a.unlocked ? <Icon className="size-5" /> : next ? <Icon className="size-5 text-accent" /> : <Lock className="size-4" />}</span>
      <p className="mt-2 line-clamp-1 text-[12.5px] font-medium text-ink">{a.title}</p>
      {a.unlocked ? (
        <p className="text-[11px] text-muted">{a.unlocked_at ? ago(a.unlocked_at) : "Unlocked"}</p>
      ) : (
        <>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(a.progress * 100)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted tabular">
            {num(a.current)} / {num(a.target)}
          </p>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 className="text-[17px] font-semibold tracking-tight text-ink">{children}</h2>
      {action}
    </div>
  );
}

export default function HomePage() {
  const ws = useWorkspace();
  const router = useRouter();
  const perms = usePermissions();
  const [task, setTask] = useState<QuickTask | null>(null);
  const progress = useQuery({ queryKey: ["progress", ws.slug], queryFn: () => get<WorkspaceProgress>("/progress"), refetchInterval: 15_000 });
  const drafts = useQuery({ queryKey: ["content", "home-drafts"], queryFn: () => get<Paged<ContentItem>>("/content", { status: "draft", limit: 3 }), refetchInterval: 15_000 });
  const approve = useAction((c: ContentItem) => post<ContentItem>(`/content/${c.id}/approve`), {
    success: (r) => `Approved “${r.title.slice(0, 48)}${r.title.length > 48 ? "…" : ""}”`,
    invalidate: [["content"], ["progress"], ["activity"], ["notifications"], ["runs"]],
  });
  const p = progress.data;
  const first = ws.me?.user.name?.split(" ")[0];
  const levelPct = p ? (p.xp - p.xp_level_start) / Math.max(1, p.xp_next_level - p.xp_level_start) : 0;
  const winsTotal = p ? p.today.runs + p.today.items + p.today.content + p.today.published : 0;
  const locked = p?.achievements.filter((a) => !a.unlocked).sort((a, b) => b.progress - a.progress) ?? [];
  const nextBadge = locked[0];
  const badges = p ? [...p.achievements.filter((a) => a.unlocked).sort((a, b) => (b.unlocked_at ?? "").localeCompare(a.unlocked_at ?? "")), ...locked] : [];
  const steps = p?.next_steps ?? [];
  const stepsLeft = steps.filter((s) => !s.done).length;

  return (
    <div className="mx-auto max-w-[1080px] space-y-12 pb-10">
      {/* Hello */}
      <div>
        <p className="text-[14px] text-muted">
          {greeting()}
          {first ? `, ${first}` : ""}
        </p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-ink">{p && winsTotal > 0 ? "Your agents have been busy today." : "What shall we get done today?"}</h1>
      </div>

      {progress.isError ? <ErrorState error={progress.error} onRetry={() => progress.refetch()} /> : null}

      {/* Level · streak · wins */}
      {!p ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-[132px] rounded-2xl" />
          <Skeleton className="h-[132px] rounded-2xl" />
          <Skeleton className="h-[132px] rounded-2xl" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[1.1fr_0.8fr_1.6fr]">
          <Card className="flex items-center gap-4 rounded-2xl p-5">
            <Ring value={levelPct}>
              <span className="text-[22px] font-semibold text-ink tabular">{p.level}</span>
            </Ring>
            <div className="min-w-0">
              <p className="text-[12px] font-medium text-muted">Level {p.level}</p>
              <p className="text-[17px] font-semibold text-ink">{p.level_name}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-2 tabular">
                {num(p.xp)} / {num(p.xp_next_level)} XP
              </p>
              <div className="mt-1.5">
                <PointsPopover rules={p.xp_rules} />
              </div>
            </div>
          </Card>
          <Card className="flex items-center gap-4 rounded-2xl p-5">
            <span className={cn("flex size-14 shrink-0 items-center justify-center rounded-2xl", p.streak_days ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted")}>
              <Flame className={cn("size-7", p.streak_days > 0 && "flame")} />
            </span>
            <div>
              <p className="text-[24px] leading-none font-semibold text-ink tabular">{p.streak_days}</p>
              <p className="mt-1 text-[13px] text-ink-2">{p.streak_days === 1 ? "day streak" : "-day streak"}</p>
              <p className="text-[11.5px] text-muted">Best: {p.best_streak_days} days</p>
            </div>
          </Card>
          <Card className="rounded-2xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink">Today&apos;s wins</p>
              <Link href="/activity" className="text-[12px] text-muted hover:text-accent">
                See everything
              </Link>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <Win label="runs" value={p.today.runs} />
              <Win label="items" value={p.today.items} />
              <Win label="written" value={p.today.content} />
              <Win label="published" value={p.today.published} />
            </div>
          </Card>
        </div>
      )}

      {/* What do you want to do? */}
      <section>
        <SectionTitle>What do you want to do?</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TASKS.map((t) => {
            const Icon = t.icon;
            const disabled = t.href ? null : perms.reason("agents.run");
            return (
              <button
                key={t.id}
                type="button"
                disabled={Boolean(disabled)}
                title={disabled ?? undefined}
                onClick={() => (t.href ? router.push(t.href) : setTask(t))}
                className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl transition-transform group-hover:scale-105" style={{ color: t.color, background: `color-mix(in oklab, ${t.color} 13%, var(--surface))` }}>
                  <Icon className="size-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">{t.title}</span>
                  <span className="mt-0.5 block text-[13px] text-ink-2">{t.blurb}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
              </button>
            );
          })}
        </div>
      </section>

      {/* Needs your OK */}
      {drafts.data?.items.length ? (
        <section>
          <SectionTitle
            action={
              <Link href="/content?status=draft" className="inline-flex items-center gap-1 text-[13px] text-ink-2 hover:text-accent">
                All {drafts.data.total} <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            Needs your OK
          </SectionTitle>
          <div className="grid gap-4 md:grid-cols-3">
            {drafts.data.items.map((c) => (
              <Card key={c.id} className="flex flex-col overflow-hidden rounded-2xl">
                <ContentThumb src={c.image_url ?? c.images?.[0]?.thumb_url ?? c.images?.[0]?.url} alt={c.title} className="h-32 w-full rounded-none" />
                <div className="flex flex-1 flex-col p-4">
                  <p className="line-clamp-2 text-[14px] leading-snug font-semibold text-ink">{c.title}</p>
                  <p className="mt-1 line-clamp-2 flex-1 text-[12.5px] text-ink-2">{c.summary}</p>
                  <p className="mt-2 text-[11.5px] text-muted">
                    {c.variants.length} formats · ready {ago(c.created_at)}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="primary" size="lg" className="flex-1" icon={<ThumbsUp className="size-4" />} loading={approve.isPending && approve.variables?.id === c.id} disabledReason={perms.reason("content.approve")} onClick={() => approve.mutate(c)}>
                      Approve
                    </Button>
                    <Button size="lg" onClick={() => router.push(`/content/${c.id}`)}>
                      Look first
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* Getting started */}
      {p && stepsLeft > 0 ? (
        <section>
          <SectionTitle action={<span className="text-[13px] text-muted">{steps.length - stepsLeft} of {steps.length} done</span>}>Getting started</SectionTitle>
          <Card className="divide-y divide-line rounded-2xl">
            {steps.map((s) => (
              <Link key={s.key} href={s.href} className="group flex items-center gap-4 px-5 py-4 hover:bg-surface-2/60">
                {s.done ? <CheckCircle2 className="size-5 shrink-0 text-ok" /> : <Circle className="size-5 shrink-0 text-line-strong group-hover:text-accent" />}
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[14px] font-medium", s.done ? "text-muted line-through" : "text-ink")}>{s.title}</span>
                  <span className="block text-[12.5px] text-muted">{s.description}</span>
                </span>
                {!s.done ? <ArrowRight className="size-4 text-muted group-hover:text-accent" /> : null}
              </Link>
            ))}
          </Card>
        </section>
      ) : null}

      {/* Achievements */}
      {p ? (
        <section>
          <SectionTitle action={<span className="text-[13px] text-muted">{p.achievements.filter((a) => a.unlocked).length} of {p.achievements.length} unlocked</span>}>Achievements</SectionTitle>
          {nextBadge ? (
            <p className="mb-3 text-[13px] text-ink-2">
              Next up: <strong className="font-medium text-ink">{nextBadge.title}</strong> · {nextBadge.description} ({num(nextBadge.current)} / {num(nextBadge.target)})
            </p>
          ) : null}
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
            {badges.map((a) => (
              <Badge key={a.key} a={a} next={a.key === nextBadge?.key} />
            ))}
          </div>
        </section>
      ) : null}

      <QuickStartDialog task={task} onClose={() => setTask(null)} />
    </div>
  );
}
