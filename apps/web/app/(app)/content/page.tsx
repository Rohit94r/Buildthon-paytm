"use client";

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Clapperboard, Facebook, FileText, Instagram, Linkedin, Mail, MessageCircle, PenLine, Twitter, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, cn, PageHeader, QueryView, Skeleton } from "@/components/ui";
import { ContentThumb } from "@/components/platform/image-gallery";
import { Empty, FilterChips, SearchInput, StatusPill } from "@/components/platform/kit";
import { get } from "@/lib/api";
import { ago } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { ContentFormat, ContentItem, ContentStatus, Paged } from "@/lib/platform-types";

const PAGE = 20;

const FORMAT_META: Record<ContentFormat, { label: string; icon: LucideIcon }> = {
  article: { label: "Article", icon: FileText },
  blog_post: { label: "Blog post", icon: PenLine },
  linkedin_post: { label: "LinkedIn", icon: Linkedin },
  x_thread: { label: "X thread", icon: Twitter },
  instagram_caption: { label: "Instagram", icon: Instagram },
  facebook_post: { label: "Facebook", icon: Facebook },
  newsletter: { label: "Newsletter", icon: Mail },
  short_video_script: { label: "Video script", icon: Clapperboard },
  whatsapp_message: { label: "WhatsApp", icon: MessageCircle },
};

type Filter = "all" | ContentStatus;
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Needs approval" },
  { value: "approved", label: "Approved" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed" },
];
const isFilter = (v: string | null): v is Filter => !!v && FILTERS.some((f) => f.value === v);

export default function ContentPage() {
  return (
    <Suspense fallback={<ContentSkeleton />}>
      <ContentList />
    </Suspense>
  );
}

function ContentList() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pipelineId = params.get("pipeline_id") ?? "";
  const urlStatus = params.get("status");

  const [status, setStatus] = useState<Filter>(isFilter(urlStatus) ? urlStatus : "all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useDebounced(search.trim(), 300);

  const onSearch = (v: string) => {
    setSearch(v);
    setOffset(0);
  };

  const changeStatus = (s: Filter) => {
    setStatus(s);
    setOffset(0);
    const next = new URLSearchParams(params.toString());
    if (s === "all") next.delete("status");
    else next.set("status", s);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const clearPipeline = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("pipeline_id");
    setOffset(0);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const list = useQuery({
    queryKey: ["content", "list", { status, q, pipelineId, offset }],
    queryFn: () => get<Paged<ContentItem>>("/content", { status: status === "all" ? undefined : status, q, pipeline_id: pipelineId, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });

  const counts = useQueries({
    queries: FILTERS.map((f) => ({
      queryKey: ["content", "count", { status: f.value, q, pipelineId }],
      queryFn: () => get<Paged<ContentItem>>("/content", { status: f.value === "all" ? undefined : f.value, q, pipeline_id: pipelineId, limit: 1, offset: 0 }),
      select: (d: Paged<ContentItem>) => d.total,
    })),
  });

  const pipelineName = list.data?.items.find((c) => c.pipeline_id === pipelineId)?.pipeline_name;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="Content" subtitle="Everything your workflows wrote, in every format. Review drafts, approve and publish." />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterChips value={status} onChange={changeStatus} options={FILTERS.map((f, i) => ({ ...f, count: counts[i]?.data }))} />
        <SearchInput value={search} onChange={onSearch} placeholder="Search titles, summaries, tags…" className="w-full lg:w-72" />
      </div>

      {pipelineId ? (
        <div className="mb-4 flex items-center gap-2 text-[12.5px] text-ink-2">
          <span>
            Workflow: <span className="font-medium text-ink">{pipelineName ?? "selected workflow"}</span>
          </span>
          <button type="button" onClick={clearPipeline} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Clear workflow filter">
            <X className="size-3.5" /> Clear
          </button>
        </div>
      ) : null}

      <QueryView
        query={list}
        skeleton={<ContentSkeleton rowsOnly />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <Empty
            icon={<FileText />}
            title={q || status !== "all" || pipelineId ? "Nothing matches" : "No content yet"}
            body={q || status !== "all" || pipelineId ? "Try another filter or search term." : "Run a workflow with a multi-format agent and its drafts will appear here for review."}
            action={
              q || status !== "all" ? (
                <Button
                  onClick={() => {
                    onSearch("");
                    changeStatus("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Link href="/pipelines" className="text-[13px] font-medium text-accent hover:underline">
                  Go to workflows →
                </Link>
              )
            }
          />
        }
      >
        {(data) => (
          <>
            <div className={cn("overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition-opacity", list.isPlaceholderData && "opacity-60")}>
              <ul className="divide-y divide-line">
                {data.items.map((c) => (
                  <ContentRow key={c.id} item={c} />
                ))}
              </ul>
            </div>
            <Pager offset={offset} total={data.total} count={data.items.length} onChange={setOffset} />
          </>
        )}
      </QueryView>
    </div>
  );
}

function ContentRow({ item }: { item: ContentItem }) {
  const score = item.quality ? (item.quality.score <= 1 ? Math.round(item.quality.score * 100) : Math.round(item.quality.score)) : null;
  const formats = Array.from(new Set(item.variants.map((v) => v.format)));
  const images = item.images ?? [];
  const thumb = item.image_url ?? images[0]?.thumb_url ?? images[0]?.url ?? null;
  return (
    <li>
      <Link href={`/content/${item.id}`} className="group flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-surface-2/60 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <ContentThumb src={thumb} alt="" className="size-14" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-ink group-hover:text-accent">{item.title}</p>
            {item.summary ? <p className="mt-0.5 line-clamp-1 text-[12.5px] text-ink-2">{item.summary}</p> : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
              {item.pipeline_name ? <span className="truncate">{item.pipeline_name}</span> : null}
              {formats.length ? (
                <span className="inline-flex items-center gap-1.5" aria-label={`Formats: ${formats.map((f) => FORMAT_META[f]?.label ?? f).join(", ")}`}>
                  {formats.map((f) => {
                    const Icon = FORMAT_META[f]?.icon ?? FileText;
                    return (
                      <span key={f} title={FORMAT_META[f]?.label ?? f}>
                        <Icon className="size-3.5" aria-hidden />
                      </span>
                    );
                  })}
                </span>
              ) : null}
              {images.length > 1 ? <span>{images.length} images</span> : null}
              <span className="sm:hidden">{ago(item.created_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4 pl-[72px] sm:pl-0">
          {score !== null ? (
            <span className="text-[12px] text-muted tabular" title="Quality score">
              <span className={cn("font-semibold", score >= 85 ? "text-ok" : score >= 70 ? "text-ink" : "text-warn")}>{score}</span>
              <span className="text-muted">/100</span>
            </span>
          ) : null}
          <StatusPill status={item.status} label={item.status === "draft" ? "Needs approval" : undefined} />
          <span className="hidden w-20 text-right text-[12px] text-muted sm:inline">{ago(item.created_at)}</span>
        </div>
      </Link>
    </li>
  );
}

function Pager({ offset, total, count, onChange }: { offset: number; total: number; count: number; onChange: (o: number) => void }) {
  if (total <= PAGE && offset === 0) return <p className="mt-3 text-[12px] text-muted">{total} item{total === 1 ? "" : "s"}</p>;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted">
      <span className="tabular">
        {offset + 1}–{offset + count} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <Button size="xs" icon={<ChevronLeft className="size-3.5" />} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE))}>
          Previous
        </Button>
        <Button size="xs" disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)}>
          Next <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ContentSkeleton({ rowsOnly }: { rowsOnly?: boolean }) {
  const rows = (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-14 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
  if (rowsOnly) return rows;
  return (
    <div className="mx-auto max-w-[1200px]">
      <Skeleton className="mb-2 h-7 w-40" />
      <Skeleton className="mb-6 h-4 w-80" />
      <Skeleton className="mb-4 h-8 w-full max-w-xl" />
      {rows}
    </div>
  );
}
