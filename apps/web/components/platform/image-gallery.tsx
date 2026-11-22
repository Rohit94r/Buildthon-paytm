"use client";

import { BadgeCheck, Check, ExternalLink, ImageOff, Star } from "lucide-react";
import { useState } from "react";
import { cn } from "@/components/ui";
import type { MediaImage } from "@/lib/platform-ops-types";
import { useCopy } from "./kit";

const SOURCE_LABEL: Record<MediaImage["source"], string> = {
  page: "From the page",
  og: "Page preview image",
  openverse: "Openverse",
  wikimedia: "Wikimedia Commons",
  upload: "Uploaded",
};

function host(u: string | null) {
  if (!u) return null;
  try {
    return new URL(u, "http://x").hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Licence pill: green for open licences, amber when unknown. */
export function LicenseBadge({ img }: { img: MediaImage }) {
  if (img.open_license)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-[3px] text-[11px] font-medium text-ok" title={img.license ?? "Open licence"}>
        <BadgeCheck className="size-3" /> Open licence{img.license ? ` · ${img.license}` : ""}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-[3px] text-[11px] font-medium text-warn" title="Check the rights before publishing">
      {img.license ?? "Licence unknown"}
    </span>
  );
}

function Thumb({ img, className }: { img: MediaImage; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <div className={cn("flex items-center justify-center bg-surface-2 text-muted", className)}>
        <ImageOff className="size-5" />
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={img.thumb_url ?? img.url} alt={img.alt ?? ""} loading="lazy" onError={() => setBroken(true)} className={cn("object-cover", className)} />;
}

/**
 * Grid of images with licence, credit, source, size and a copyable perceptual hash.
 * `cover` + `onSetCover` turn on the "Set as cover" action.
 */
export function ImageGallery({ images, cover, onSetCover, coverDisabledReason, empty }: { images: MediaImage[]; cover?: string | null; onSetCover?: (img: MediaImage) => void; coverDisabledReason?: string | null; empty?: string }) {
  const [copied, copy] = useCopy();
  if (!images.length) return <p className="py-6 text-center text-[13px] text-muted">{empty ?? "No images yet."}</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {images.map((img, i) => {
        const isCover = Boolean(cover && cover === img.url);
        return (
          <figure key={`${img.url}-${i}`} className={cn("overflow-hidden rounded-xl border bg-surface shadow-sm", isCover ? "border-accent ring-2 ring-accent/20" : "border-line")}>
            <div className="relative">
              <Thumb img={img} className="aspect-[4/3] w-full" />
              {isCover ? (
                <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-accent-solid px-2 py-0.5 text-[11px] font-medium text-accent-ink shadow">
                  <Star className="size-3" /> Cover
                </span>
              ) : null}
            </div>
            <figcaption className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <LicenseBadge img={img} />
                <span className="text-[11px] text-muted">{SOURCE_LABEL[img.source] ?? img.source}</span>
              </div>
              {img.alt ? <p className="line-clamp-2 text-[12.5px] text-ink">{img.alt}</p> : null}
              {img.credit ? <p className="truncate text-[11.5px] text-ink-2">© {img.credit}</p> : null}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                {img.width && img.height ? (
                  <span className="tabular">
                    {img.width}×{img.height}
                  </span>
                ) : null}
                {img.page_url ? (
                  <a href={img.page_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-accent">
                    {host(img.page_url) ?? "source"} <ExternalLink className="size-3" />
                  </a>
                ) : null}
                {img.license_url ? (
                  <a href={img.license_url} target="_blank" rel="noreferrer" className="hover:text-accent">
                    licence
                  </a>
                ) : null}
                {img.hash ? (
                  <button type="button" onClick={() => copy(img.hash as string, img.hash as string)} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2 hover:text-ink" title="Perceptual hash: equal or near hashes are the same picture. Click to copy.">
                    {copied === img.hash ? (
                      <span className="inline-flex items-center gap-1">
                        <Check className="size-3 text-ok" /> copied
                      </span>
                    ) : (
                      img.hash
                    )}
                  </button>
                ) : null}
              </div>
              {onSetCover ? (
                <button
                  type="button"
                  disabled={isCover || Boolean(coverDisabledReason)}
                  title={coverDisabledReason ?? undefined}
                  onClick={() => onSetCover(img)}
                  className="w-full rounded-lg border border-line py-1.5 text-[12px] font-medium text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-50"
                >
                  {isCover ? "This is the cover" : "Set as cover"}
                </button>
              ) : null}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** Small square thumbnail for lists (falls back to a soft placeholder). */
export function ContentThumb({ src, alt, className }: { src: string | null | undefined; alt?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div className={cn("shrink-0 rounded-lg bg-gradient-to-br from-accent-soft to-surface-2", className)} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt ?? ""} loading="lazy" onError={() => setBroken(true)} className={cn("shrink-0 rounded-lg object-cover", className)} />;
}
