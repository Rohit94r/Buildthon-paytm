"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clapperboard,
  ExternalLink,
  Facebook,
  FileText,
  Globe2,
  Heart,
  ImageOff,
  Images,
  Instagram,
  Linkedin,
  Mail,
  MessageCircle,
  Pencil,
  PenLine,
  Repeat2,
  Send,
  ThumbsUp,
  Trash2,
  Twitter,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Banner, Button, Card, Checkbox, cn, Dialog, Field, PageHeader, QueryView, Skeleton, Tabs, Textarea } from "@/components/ui";
import { ImageGallery, LicenseBadge } from "@/components/platform/image-gallery";
import { CopyButton, Empty, Markdown, StatusPill, usePermissions } from "@/components/platform/kit";
import { del, get, patch, post } from "@/lib/api";
import { ago, dateTime, hostOf, initials, titleCase } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { MediaImage } from "@/lib/platform-ops-types";
import type { Connection, ContentFormat, ContentItem, ContentPublication, ContentVariant } from "@/lib/platform-types";
import { useWorkspace } from "@/lib/workspace";

const FORMAT_META: Record<ContentFormat, { label: string; icon: LucideIcon; limit?: number }> = {
  article: { label: "Article", icon: FileText },
  blog_post: { label: "Blog post", icon: PenLine },
  linkedin_post: { label: "LinkedIn", icon: Linkedin, limit: 3000 },
  x_thread: { label: "X thread", icon: Twitter, limit: 280 },
  instagram_caption: { label: "Instagram", icon: Instagram, limit: 2200 },
  facebook_post: { label: "Facebook", icon: Facebook, limit: 63206 },
  newsletter: { label: "Newsletter", icon: Mail },
  short_video_script: { label: "Video script", icon: Clapperboard },
  whatsapp_message: { label: "WhatsApp", icon: MessageCircle, limit: 4096 },
};
const LONG_FORM: ContentFormat[] = ["article", "blog_post", "newsletter"];

/** A tab is one format, or the "images" tab. */
type TabKey = ContentFormat | "images";

/** Older backends may not send `images` yet. */
const imagesOf = (item: ContentItem): MediaImage[] => item.images ?? [];

const splitThread = (body: string) =>
  body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

export default function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({ queryKey: ["content", "item", id], queryFn: () => get<ContentItem>(`/content/${id}`), enabled: !!id });

  return (
    <div className="mx-auto max-w-[1200px]">
      <Link href="/content" className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Content
      </Link>
      <QueryView query={query} skeleton={<DetailSkeleton />}>
        {(item) => <ContentDetail item={item} />}
      </QueryView>
    </div>
  );
}

/* ====================================================================== */

function ContentDetail({ item }: { item: ContentItem }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can, reason } = usePermissions();
  const denied = reason("content.approve");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const formats = useMemo(() => {
    const seen = new Set<ContentFormat>();
    return item.variants.filter((v) => (seen.has(v.format) ? false : (seen.add(v.format), true))).map((v) => v.format);
  }, [item.variants]);
  const images = imagesOf(item);
  const tabKeys: TabKey[] = images.length ? [...formats, "images"] : formats;
  const [tab, setTab] = useState<TabKey | null>(formats[0] ?? null);
  const active: TabKey | null = tab && tabKeys.includes(tab) ? tab : (tabKeys[0] ?? null);

  const approve = useAction(() => post<ContentItem>(`/content/${item.id}/approve`), { success: "Approved", invalidate: [["content"]] });
  const remove = useAction(() => del<void>(`/content/${item.id}`), {
    success: "Content deleted",
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["content"], predicate: (q) => q.queryKey[2] !== item.id });
      router.push("/content");
    },
  });

  const s = item.status;
  const actions: ReactNode[] = [];
  if (s === "draft" || s === "rejected" || s === "failed") {
    actions.push(
      <Button key="reject" onClick={() => setRejectOpen(true)} disabledReason={s === "rejected" ? "Already rejected" : denied}>
        Reject
      </Button>,
    );
  }
  if (s === "approved") {
    actions.push(
      <Button key="reject" onClick={() => setRejectOpen(true)} disabledReason={denied}>
        Reject
      </Button>,
    );
  }
  if (s === "draft" || s === "rejected") {
    actions.push(
      <Button key="approve" variant="primary" icon={<Check className="size-3.5" />} loading={approve.isPending} onClick={() => approve.mutate(undefined)} disabledReason={denied}>
        Approve
      </Button>,
    );
  }
  if (s === "approved" || s === "published" || s === "failed") {
    actions.push(
      <Button key="publish" variant={s === "published" ? "secondary" : "primary"} icon={<Send className="size-3.5" />} onClick={() => setPublishOpen(true)} disabledReason={denied}>
        {s === "published" ? "Publish again…" : "Publish to…"}
      </Button>,
    );
  }

  const meta: ReactNode[] = [];
  if (item.pipeline_name) {
    meta.push(
      item.pipeline_id ? (
        <Link key="p" href={`/pipelines/${item.pipeline_id}`} className="hover:text-ink hover:underline">
          {item.pipeline_name}
        </Link>
      ) : (
        <span key="p">{item.pipeline_name}</span>
      ),
    );
  }
  if (item.run_id) {
    meta.push(
      <Link key="r" href={`/runs/${item.run_id}`} className="hover:text-ink hover:underline">
        View run
      </Link>,
    );
  }
  if (item.source_url) {
    meta.push(
      <a key="s" href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink hover:underline">
        {item.source_name || hostOf(item.source_url)} <ExternalLink className="size-3" />
      </a>,
    );
  }
  meta.push(<span key="t">{ago(item.created_at)}</span>);

  return (
    <>
      <PageHeader
        title={<span className="block max-w-3xl">{item.title}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill status={s} label={s === "draft" ? "Needs approval" : undefined} />
            {meta.map((m, i) => (
              <span key={i} className="inline-flex items-center gap-2 text-muted">
                <span aria-hidden>·</span>
                {m}
              </span>
            ))}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleteOpen(true)} disabledReason={denied} aria-label="Delete content" title="Delete">
              <span className="sr-only">Delete</span>
            </Button>
            {actions}
          </>
        }
      />

      {s === "draft" ? (
        <Banner tone="warn" title="Waiting for your approval" className="mb-6">
          {item.run_id ? "Approving resumes the workflow run, so its publisher step delivers this content." : "Approve it to make it ready for publishing."}
        </Banner>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {tabKeys.length && active ? (
            <>
              <Tabs<TabKey>
                value={active}
                onChange={setTab}
                className="mb-5"
                tabs={tabKeys.map((f) => {
                  if (f === "images")
                    return {
                      value: f,
                      label: (
                        <span className="inline-flex items-center gap-1.5">
                          <Images className="size-3.5" aria-hidden />
                          Images
                        </span>
                      ),
                      count: images.length,
                    };
                  const Icon = FORMAT_META[f]?.icon ?? FileText;
                  return {
                    value: f,
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <Icon className="size-3.5" aria-hidden />
                        {FORMAT_META[f]?.label ?? titleCase(f)}
                      </span>
                    ),
                  };
                })}
              />
              {active === "images" ? (
                <ImagesPanel item={item} canEdit={can("content.approve")} editReason={denied} />
              ) : (
                <VariantPanel key={active} item={item} format={active} canEdit={can("content.approve")} editReason={denied} />
              )}
            </>
          ) : (
            <Empty icon={<FileText />} title="No formats yet" body="This item has no generated variants." />
          )}
        </div>
        <SidePanel item={item} />
      </div>

      <RejectDialog open={rejectOpen} onClose={() => setRejectOpen(false)} item={item} />
      <PublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} item={item} />
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        size="sm"
        title="Delete this content?"
        description="All formats and the publication history are removed. Posts already live on other sites stay there."
        footer={
          <>
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(undefined)} data-autofocus>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">“{item.title}”</p>
      </Dialog>
    </>
  );
}

/* ---------------- Images tab ---------------- */

function ImagesPanel({ item, canEdit, editReason }: { item: ContentItem; canEdit: boolean; editReason: string | null }) {
  const images = imagesOf(item);
  const setCover = useAction((img: MediaImage) => patch<ContentItem>(`/content/${item.id}`, { image_url: img.url }), {
    success: "Cover picture updated",
    error: "Couldn't change the cover",
    invalidate: [["content"]],
  });
  const unknown = images.filter((i) => !i.open_license).length;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-[13px] leading-relaxed text-ink-2">
        <p>
          Pictures your agents found for this piece. Ones marked <span className="font-medium text-ok">Open licence</span> can be published as long as you keep the credit shown.
          {unknown ? ` ${unknown === 1 ? "One picture has" : `${unknown} pictures have`} an unknown licence, so check the rights before using ${unknown === 1 ? "it" : "them"}.` : ""}
        </p>
        <p className="mt-1 text-muted">The cover is the picture shown at the top of the article and on your website.</p>
      </div>
      <ImageGallery
        images={images}
        cover={item.image_url}
        onSetCover={(img) => setCover.mutate(img)}
        coverDisabledReason={!canEdit ? (editReason ?? "You can't change the cover") : setCover.isPending ? "Saving…" : null}
        empty="No pictures were found for this piece yet."
      />
    </div>
  );
}

function CoverImage({ item }: { item: ContentItem }) {
  const [broken, setBroken] = useState(false);
  const src = item.image_url;
  if (!src) return null;
  const meta = imagesOf(item).find((i) => i.url === src);
  if (broken)
    return (
      <div className="mb-8 flex aspect-[16/9] items-center justify-center gap-2 rounded-xl bg-surface-2 text-[12.5px] text-muted">
        <ImageOff className="size-4" aria-hidden /> The cover picture couldn&apos;t be loaded
      </div>
    );
  return (
    <figure className="mb-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={meta?.alt ?? ""} onError={() => setBroken(true)} className="aspect-[16/9] w-full rounded-xl object-cover" />
      {meta && (meta.credit || meta.license) ? (
        <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          {meta.credit ? <span>© {meta.credit}</span> : null}
          <LicenseBadge img={meta} />
        </figcaption>
      ) : null}
    </figure>
  );
}

/* ---------------- Variant tabs ---------------- */

function VariantPanel({ item, format, canEdit, editReason }: { item: ContentItem; format: ContentFormat; canEdit: boolean; editReason: string | null }) {
  const variant = item.variants.find((v) => v.format === format) as ContentVariant;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(variant.body);
  const save = useAction(
    (body: string) =>
      patch<ContentItem>(`/content/${item.id}`, {
        variants: item.variants.map((v) => (v.format === format ? { ...v, body, char_count: body.length } : v)),
      }),
    { success: `${FORMAT_META[format]?.label ?? "Variant"} saved`, invalidate: [["content"]], onSuccess: () => setEditing(false) },
  );
  const limit = FORMAT_META[format]?.limit;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[12px] text-muted tabular">
          {format === "x_thread" ? `${splitThread(variant.body).length} posts · ` : ""}
          {variant.body.length.toLocaleString("en-IN")} characters
          {LONG_FORM.includes(format) ? ` · ${Math.max(1, Math.round(variant.body.split(/\s+/).length / 220))} min read` : ""}
        </p>
        {editing ? (
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setDraft(variant.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button size="xs" variant="primary" loading={save.isPending} disabled={draft === variant.body || !draft.trim()} onClick={() => save.mutate(draft)}>
              Save
            </Button>
          </div>
        ) : (
          <Button
            size="xs"
            icon={<Pencil className="size-3" />}
            disabledReason={!canEdit ? editReason : null}
            onClick={() => {
              setDraft(variant.body);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </div>

      {editing ? (
        <div>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={format === "x_thread" ? 14 : 20} className={cn("min-h-[320px]", LONG_FORM.includes(format) && "font-mono text-[12.5px]")} aria-label={`Edit ${FORMAT_META[format]?.label}`} />
          <div className="mt-1.5 flex items-center justify-between gap-3 text-[11.5px] text-muted">
            <span>{format === "x_thread" ? "Separate posts with a blank line." : LONG_FORM.includes(format) ? "Markdown supported." : ""}</span>
            {format === "x_thread" ? (
              <span className="tabular">
                {splitThread(draft).length} posts{splitThread(draft).some((t) => t.length > 280) ? <span className="text-bad"> · some over 280</span> : null}
              </span>
            ) : (
              <Counter value={draft.length} limit={limit} />
            )}
          </div>
        </div>
      ) : (
        <VariantPreview item={item} variant={variant} />
      )}
    </div>
  );
}

function Counter({ value, limit, className }: { value: number; limit?: number; className?: string }) {
  if (!limit) return <span className={cn("tabular", className)}>{value.toLocaleString("en-IN")} chars</span>;
  const over = value > limit;
  const near = !over && value > limit * 0.9;
  return (
    <span className={cn("text-[11.5px] tabular", over ? "font-medium text-bad" : near ? "text-warn" : "text-muted", className)}>
      {value.toLocaleString("en-IN")} / {limit.toLocaleString("en-IN")}
    </span>
  );
}

function VariantPreview({ item, variant }: { item: ContentItem; variant: ContentVariant }) {
  switch (variant.format) {
    case "article":
    case "blog_post":
    case "newsletter":
      return <LongFormPreview item={item} variant={variant} />;
    case "linkedin_post":
      return <LinkedInPreview body={variant.body} />;
    case "x_thread":
      return <XThreadPreview body={variant.body} />;
    case "instagram_caption":
      return <InstagramPreview title={variant.title ?? item.title} body={variant.body} />;
    case "short_video_script":
      return <VideoScriptPreview body={variant.body} />;
    default:
      return (
        <Card className="mx-auto max-w-[640px] p-5">
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{variant.body}</p>
          <div className="mt-4 flex justify-end">
            <Counter value={variant.body.length} limit={FORMAT_META[variant.format]?.limit} />
          </div>
        </Card>
      );
  }
}

function LongFormPreview({ item, variant }: { item: ContentItem; variant: ContentVariant }) {
  const title = variant.title ?? item.title;
  // Don't repeat the title when the body already opens with it as a heading.
  const body = variant.body.replace(/^\s*#\s+(.+)\n+/, (m, h: string) => (h.trim() === title.trim() ? "" : m));
  return (
    <Card className="px-5 py-8 sm:px-10 sm:py-12">
      <article className="mx-auto max-w-[680px]">
        <CoverImage key={item.image_url ?? "none"} item={item} />
        <h1 className="mb-6 font-serif text-[28px] leading-tight font-semibold tracking-tight text-ink sm:text-[32px]">{title}</h1>
        <Markdown text={body} serif />
      </article>
    </Card>
  );
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-ink", size === "md" ? "size-12 text-[15px]" : "size-10 text-[13px]")} aria-hidden>
      {initials(name) || "LF"}
    </span>
  );
}

function LinkedInPreview({ body }: { body: string }) {
  const ws = useWorkspace();
  const name = ws.name || "Your workspace";
  return (
    <div className="mx-auto max-w-[555px]">
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 px-4 pt-4">
          <Avatar name={name} />
          <div className="min-w-0">
            <p className="text-[14px] leading-tight font-semibold text-ink">{name}</p>
            <p className="text-[12px] text-muted">Company page</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-muted">
              Now · <Globe2 className="size-3" aria-hidden />
            </p>
          </div>
        </div>
        <p className="px-4 pt-3 pb-4 text-[14px] leading-[1.45] whitespace-pre-wrap text-ink">{body}</p>
        <div className="flex items-center justify-around border-t border-line px-2 py-1.5 text-[12.5px] font-medium text-muted" aria-hidden>
          {[
            [ThumbsUp, "Like"],
            [MessageCircle, "Comment"],
            [Repeat2, "Repost"],
            [Send, "Send"],
          ].map(([Icon, label]) => {
            const I = Icon as LucideIcon;
            return (
              <span key={label as string} className="inline-flex items-center gap-1.5 px-2 py-1.5">
                <I className="size-4" /> {label as string}
              </span>
            );
          })}
        </div>
      </Card>
      <div className="mt-2 flex justify-end">
        <Counter value={body.length} limit={3000} />
      </div>
    </div>
  );
}

function XThreadPreview({ body }: { body: string }) {
  const ws = useWorkspace();
  const name = ws.name || "Your workspace";
  const handle = `@${(ws.slug ?? "layerflow").replace(/[^a-z0-9_]/gi, "")}`;
  const posts = splitThread(body);
  return (
    <div className="mx-auto max-w-[560px]">
      <Card className="divide-y divide-line">
        {posts.map((p, i) => (
          <div key={i} className="flex gap-3 px-4 py-3.5">
            <div className="flex flex-col items-center">
              <Avatar name={name} size="sm" />
              {i < posts.length - 1 ? <span className="mt-1 w-px flex-1 bg-line-strong" aria-hidden /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-tight">
                <span className="font-semibold text-ink">{name}</span> <span className="text-muted">{handle}</span>
              </p>
              <p className="mt-1 text-[14px] leading-[1.45] break-words whitespace-pre-wrap text-ink">{p}</p>
              <div className="mt-2 flex items-center justify-between text-muted">
                <span className="inline-flex items-center gap-4" aria-hidden>
                  <MessageCircle className="size-3.5" />
                  <Repeat2 className="size-3.5" />
                  <Heart className="size-3.5" />
                </span>
                <Counter value={p.length} limit={280} />
              </div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function InstagramPreview({ title, body }: { title: string; body: string }) {
  const ws = useWorkspace();
  const handle = (ws.slug ?? "layerflow").replace(/[^a-z0-9_.]/gi, "");
  return (
    <div className="mx-auto grid max-w-[880px] gap-5 md:grid-cols-2">
      <div
        className="relative flex aspect-square items-end overflow-hidden rounded-xl p-6 shadow-sm"
        style={{ background: "linear-gradient(140deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 45%, #7c3aed) 55%, color-mix(in oklab, var(--accent) 30%, #f97316) 100%)" }}
      >
        <span className="absolute top-5 left-6 text-[11px] font-semibold tracking-[0.18em] text-white/80 uppercase">{ws.name || handle}</span>
        <p className="text-[22px] leading-snug font-semibold tracking-tight text-white drop-shadow-sm sm:text-[24px]">{title}</p>
      </div>
      <Card className="flex flex-col p-4">
        <p className="mb-2 text-[13.5px] font-semibold text-ink">{handle}</p>
        <p className="flex-1 text-[13.5px] leading-[1.5] whitespace-pre-wrap text-ink">{body}</p>
        <div className="mt-4 flex justify-end">
          <Counter value={body.length} limit={2200} />
        </div>
      </Card>
    </div>
  );
}

function VideoScriptPreview({ body }: { body: string }) {
  const scenes = splitThread(body);
  return (
    <div className="mx-auto max-w-[680px] space-y-3">
      {scenes.map((scene, i) => {
        const lines = scene.split("\n");
        const head = lines[0].match(/^\[([^\]]+)\]\s*(?:\(([^)]+)\))?\s*(.*)$/);
        const rest = head ? lines.slice(1) : lines;
        return (
          <Card key={i} className="px-4 py-3.5">
            {head ? (
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-accent uppercase">{head[1]}</span>
                {head[2] ? <span className="font-mono text-[11.5px] text-muted tabular">{head[2]}</span> : null}
                {head[3] ? <span className="text-[13px] text-ink">{head[3]}</span> : null}
              </div>
            ) : null}
            <div className="space-y-1.5">
              {rest.map((l, j) => {
                const cue = l.match(/^(VO|On screen|B-roll|SFX|Music|Text|Caption|Visual|Cut to)\s*:\s*(.*)$/i);
                if (cue) {
                  const vo = /^vo$/i.test(cue[1]);
                  return (
                    <p key={j} className="grid grid-cols-[84px_1fr] gap-3 text-[13.5px] leading-relaxed">
                      <span className={cn("pt-0.5 text-[11px] font-semibold tracking-wide uppercase", vo ? "text-accent" : "text-muted")}>{cue[1]}</span>
                      <span className={vo ? "text-ink" : "text-ink-2 italic"}>{cue[2]}</span>
                    </p>
                  );
                }
                return (
                  <p key={j} className="text-[13.5px] leading-relaxed text-ink">
                    {l}
                  </p>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------- Side panel ---------------- */

function SideBlock({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function LengthHint({ value, max }: { value: number; max: number }) {
  return <span className={cn("text-[11px] tabular", value > max ? "text-bad" : "text-muted")}>{value}/{max}</span>;
}

function SidePanel({ item }: { item: ContentItem }) {
  const score = item.quality ? (item.quality.score <= 1 ? Math.round(item.quality.score * 100) : Math.round(item.quality.score)) : null;
  const seo = item.seo;
  return (
    <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
      <Card>
        {score !== null ? (
          <SideBlock title="Quality">
            <div className="flex items-baseline gap-1.5">
              <span className={cn("text-[28px] leading-none font-semibold tracking-tight tabular", score >= 85 ? "text-ok" : score >= 70 ? "text-ink" : "text-warn")}>{score}</span>
              <span className="text-[12px] text-muted">/ 100</span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className={cn("h-full rounded-full", score >= 85 ? "bg-ok" : score >= 70 ? "bg-accent" : "bg-warn")} style={{ width: `${score}%` }} />
            </div>
            {item.quality?.flags.length ? (
              <ul className="mt-3 space-y-1.5">
                {item.quality.flags.map((f) => (
                  <li key={f} className="flex gap-2 text-[12.5px] leading-snug text-ink-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2.5 text-[12px] text-muted">No flags raised.</p>
            )}
          </SideBlock>
        ) : null}

        {seo && (seo.title_tag || seo.meta_description || seo.keywords?.length) ? (
          <SideBlock title="SEO">
            <div className="space-y-3">
              {seo.title_tag ? (
                <div>
                  <div className="mb-0.5 flex items-center justify-between text-[11.5px] text-muted">
                    <span>Title tag</span>
                    <LengthHint value={seo.title_tag.length} max={60} />
                  </div>
                  <p className="text-[13px] leading-snug font-medium text-ink">{seo.title_tag}</p>
                </div>
              ) : null}
              {seo.meta_description ? (
                <div>
                  <div className="mb-0.5 flex items-center justify-between text-[11.5px] text-muted">
                    <span>Meta description</span>
                    <LengthHint value={seo.meta_description.length} max={160} />
                  </div>
                  <p className="text-[12.5px] leading-snug text-ink-2">{seo.meta_description}</p>
                </div>
              ) : null}
              {seo.keywords?.length ? (
                <div className="flex flex-wrap gap-1">
                  {[...new Set(seo.keywords)].map((k) => (
                    <span key={k} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-ink-2">
                      {k}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </SideBlock>
        ) : null}

        {item.tags.length ? (
          <SideBlock title="Tags">
            <div className="flex flex-wrap gap-1">
              {item.tags.map((t) => (
                <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[11.5px] text-ink-2">
                  #{t}
                </span>
              ))}
            </div>
          </SideBlock>
        ) : null}

        <SideBlock title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            {item.persona ? (
              <>
                <dt className="text-muted">Voice</dt>
                <dd className="truncate text-ink">{item.persona}</dd>
              </>
            ) : null}
            <dt className="text-muted">Created</dt>
            <dd className="text-ink">{dateTime(item.created_at)}</dd>
            <dt className="text-muted">Updated</dt>
            <dd className="text-ink">{ago(item.updated_at)}</dd>
            {item.published_at ? (
              <>
                <dt className="text-muted">Published</dt>
                <dd className="text-ink">{dateTime(item.published_at)}</dd>
              </>
            ) : null}
            <dt className="text-muted">Slug</dt>
            <dd className="truncate font-mono text-[11.5px] text-ink-2" title={item.slug}>
              {item.slug}
            </dd>
          </dl>
        </SideBlock>
      </Card>

      <Card>
        <SideBlock title="Publications" aside={item.publications.length ? <span className="text-[11px] text-muted tabular">{item.publications.length}</span> : null}>
          {item.publications.length ? (
            <ul className="space-y-3">
              {[...item.publications]
                .sort((a, b) => (a.at < b.at ? 1 : -1))
                .map((p, i) => (
                  <PublicationRow key={`${p.connection_id}-${p.format}-${i}`} p={p} item={item} />
                ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">Not published anywhere yet.</p>
          )}
        </SideBlock>
      </Card>
    </aside>
  );
}

function PublicationRow({ p, item }: { p: ContentPublication; item: ContentItem }) {
  const body = item.variants.find((v) => v.format === p.format)?.body ?? "";
  return (
    <li className="text-[12.5px]">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-ink">{p.connection_name}</span>
        <StatusPill status={p.status} />
      </div>
      <p className="mt-0.5 text-[11.5px] text-muted">
        {FORMAT_META[p.format]?.label ?? titleCase(p.format)} · {ago(p.at)}
      </p>
      {p.url ? (
        <a href={p.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[12px] text-accent hover:underline">
          <span className="truncate">{hostOf(p.url)}</span> <ExternalLink className="size-3 shrink-0" />
        </a>
      ) : null}
      {p.error ? <p className="mt-1 text-[12px] leading-snug text-bad">{p.error}</p> : null}
      {p.status === "manual" && body ? (
        <div className="mt-1.5 flex items-center gap-2">
          <CopyButton text={body} label={`Copy ${FORMAT_META[p.format]?.label ?? "post"}`} />
          <span className="text-[11px] text-muted">Paste it manually</span>
        </div>
      ) : null}
    </li>
  );
}

/* ---------------- Dialogs ---------------- */

function RejectDialog({ open, onClose, item }: { open: boolean; onClose: () => void; item: ContentItem }) {
  const [reasonText, setReasonText] = useState("");
  const reject = useAction((reason: string) => post<ContentItem>(`/content/${item.id}/reject`, { reason }), {
    success: "Rejected",
    invalidate: [["content"]],
    onSuccess: () => {
      setReasonText("");
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Reject this content"
      description="The reason is saved with the item so the team knows what to fix."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={reject.isPending} onClick={() => reject.mutate(reasonText.trim())}>
            Reject
          </Button>
        </>
      }
    >
      <Field label="Reason" hint="Optional, but helps whoever edits it next.">
        <Textarea rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="e.g. The repo rate figure is from last month" />
      </Field>
    </Dialog>
  );
}

function PublishDialog({ open, onClose, item }: { open: boolean; onClose: () => void; item: ContentItem }) {
  const conns = useQuery({ queryKey: ["connections"], queryFn: () => get<{ items: Connection[] }>("/connections"), enabled: open, select: (d) => d.items });
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = picked ?? (conns.data ?? []).filter((c) => c.status === "connected").map((c) => c.id);
  const publish = useAction((ids: string[]) => post<ContentItem>(`/content/${item.id}/publish`, { connection_ids: ids }), {
    success: (r, ids) => {
      const failed = r.publications.filter((p) => ids.includes(p.connection_id) && p.status === "failed").length;
      return failed ? `Sent to ${ids.length} connection${ids.length === 1 ? "" : "s"}, ${failed} failed` : `Sent to ${ids.length} connection${ids.length === 1 ? "" : "s"}`;
    },
    invalidate: [["content"]],
    onSuccess: () => {
      setPicked(null);
      onClose();
    },
  });
  const toggle = (id: string, on: boolean) => setPicked((on ? [...selected, id] : selected.filter((x) => x !== id)).filter((v, i, a) => a.indexOf(v) === i));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Publish to…"
      description="Each connection receives the format it supports. Connections without API access get a ready-to-paste manual post."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Send className="size-3.5" />} loading={publish.isPending} disabledReason={selected.length === 0 ? "Pick at least one connection" : null} onClick={() => publish.mutate(selected)}>
            Publish{selected.length ? ` to ${selected.length}` : ""}
          </Button>
        </>
      }
    >
      <QueryView
        query={conns}
        skeleton={
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        }
        isEmpty={(d) => d.length === 0}
        empty={
          <Empty
            title="No connections yet"
            body="Connect your website, LinkedIn or Telegram to publish from here."
            action={
              <Link href="/connections" className="text-[13px] font-medium text-accent hover:underline">
                Add a connection →
              </Link>
            }
          />
        }
      >
        {(list) => (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {list.map((c) => {
              const on = selected.includes(c.id);
              const prior = item.publications.filter((p) => p.connection_id === c.id);
              return (
                <li key={c.id}>
                  <label className={cn("flex cursor-pointer items-center gap-3 px-3.5 py-3 transition-colors hover:bg-surface-2/60", on && "bg-accent-soft/50")}>
                    <Checkbox checked={on} onChange={(v) => toggle(c.id, v)} label={c.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{c.name}</span>
                      <span className="block text-[11.5px] text-muted">
                        {titleCase(c.kind)}
                        {prior.length ? ` · already ${prior[prior.length - 1].status}` : ""}
                      </span>
                    </span>
                    <StatusPill status={c.status} />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </QueryView>
    </Dialog>
  );
}

/* ---------------- Skeleton ---------------- */

function DetailSkeleton() {
  return (
    <div>
      <Skeleton className="mb-2 h-8 w-2/3" />
      <Skeleton className="mb-8 h-4 w-80" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-[420px] w-full rounded-xl" />
        </div>
        <Skeleton className="h-[420px] w-full rounded-xl" />
      </div>
    </div>
  );
}

