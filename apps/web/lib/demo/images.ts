// Demo images: small local SVG placeholders (public/demo/*.svg) wrapped in realistic MediaImage metadata
// (Openverse / Wikimedia / page / og sources, a mix of open and unknown licences). Deterministic per seed.
import type { MediaImage } from "../platform-ops-types";
import { seeded } from "./core";

type Theme = "market" | "campus" | "hackathon" | "city" | "product" | "document" | "generic";

const FILES: Record<Theme, { file: string; alt: string }[]> = {
  market: [
    { file: "market-1", alt: "Rising market chart with candlesticks" },
    { file: "market-2", alt: "Bar chart with a rupee coin" },
    { file: "city-1", alt: "Mumbai skyline at sunset" },
  ],
  campus: [
    { file: "campus-1", alt: "College main building with columns" },
    { file: "campus-2", alt: "Graduation cap on a stack of books" },
    { file: "document-1", alt: "Admission notice document" },
  ],
  hackathon: [
    { file: "hackathon-1", alt: "Code brackets on an orange background" },
    { file: "hackathon-2", alt: "Winner's trophy with a star" },
    { file: "abstract-1", alt: "Abstract waves on a purple background" },
  ],
  city: [
    { file: "city-1", alt: "City skyline at dusk" },
    { file: "abstract-1", alt: "Abstract waves on a purple background" },
    { file: "market-2", alt: "Bar chart with a coin" },
  ],
  product: [
    { file: "product-1", alt: "Shopping bag with a sale tag" },
    { file: "market-1", alt: "Price trend chart" },
    { file: "abstract-1", alt: "Abstract waves" },
  ],
  document: [{ file: "document-1", alt: "Pages of a PDF document" }],
  generic: [
    { file: "abstract-1", alt: "Abstract waves on a purple background" },
    { file: "city-1", alt: "City skyline at dusk" },
    { file: "product-1", alt: "Shopping bag with a tag" },
  ],
};

const CREATORS = ["Priya Nair", "Arjun Menon", "Kavya Reddy", "Rahul Verma", "Sneha Kulkarni", "Imran Qureshi", "Divya Sharma"];
const WIKI_FILES = ["Mumbai_skyline_2025.jpg", "Bombay_Stock_Exchange_building.jpg", "IIT_Madras_main_building.jpg", "Bengaluru_tech_park.jpg", "Students_at_hackathon.jpg", "Delhi_Connaught_Place.jpg"];

function hex(rng: () => number, len: number): string {
  let s = "";
  while (s.length < len) s += Math.floor(rng() * 16).toString(16);
  return s;
}

export function themeFor(industry: string | null | undefined, hint = ""): Theme {
  const h = `${industry ?? ""} ${hint}`.toLowerCase();
  if (/pdf|document|notice|brochure/.test(h)) return "document";
  if (/news_media|market|ipo|sensex|nifty|rbi|finance|stock/.test(h)) return "market";
  if (/education|college|campus|admission|jee|neet/.test(h)) return "campus";
  if (/events|hackathon|devfest/.test(h)) return "hackathon";
  if (/ecommerce|product|price|shop|deal/.test(h)) return "product";
  if (/executive|leadership|ceo/.test(h)) return "city";
  return "generic";
}

/**
 * 1–3 images for a piece of content or an item. The first one is the suggested cover.
 * `pageUrl` / `sourceName` describe the page the item came from (used for page/og images).
 */
export function demoImages(seed: string, theme: Theme, opts: { pageUrl?: string | null; sourceName?: string | null; title?: string | null; count?: number } = {}): MediaImage[] {
  const rng = seeded(`img:${seed}`);
  const pool = FILES[theme] ?? FILES.generic;
  const n = Math.max(1, Math.min(pool.length, opts.count ?? 1 + Math.floor(rng() * 3)));
  const start = Math.floor(rng() * pool.length);
  const page = opts.pageUrl ?? null;
  const site = (() => {
    try {
      return page ? new URL(page).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();
  const out: MediaImage[] = [];
  for (let i = 0; i < n; i++) {
    const pick = pool[(start + i) % pool.length];
    const url = `/demo/${pick.file}.svg`;
    const roll = rng();
    // first image prefers an open licence; later ones are a mix
    const kind = i === 0 ? (roll < 0.45 ? "openverse" : roll < 0.75 ? "wikimedia" : "og") : roll < 0.3 ? "openverse" : roll < 0.5 ? "wikimedia" : roll < 0.8 ? "page" : "og";
    const creator = CREATORS[Math.floor(rng() * CREATORS.length)];
    const w = [1200, 1600, 1920, 2400][Math.floor(rng() * 4)];
    const hgt = Math.round((w * 2) / 3);
    const alt = opts.title && i === 0 ? `${pick.alt} (illustration for “${opts.title.slice(0, 60)}”)` : pick.alt;
    const base = { url, thumb_url: url, width: w, height: hgt, hash: hex(rng, 16), alt };
    if (kind === "openverse") {
      const by = rng() < 0.6;
      out.push({ ...base, source: "openverse", page_url: `https://openverse.org/image/${hex(rng, 8)}-${hex(rng, 4)}-${hex(rng, 4)}-${hex(rng, 4)}-${hex(rng, 12)}`, license: by ? "CC BY 4.0" : "CC0", license_url: by ? "https://creativecommons.org/licenses/by/4.0/" : "https://creativecommons.org/publicdomain/zero/1.0/", open_license: true, credit: by ? `Photo: ${creator} / Openverse (CC BY 4.0)` : `${creator} (CC0)` });
    } else if (kind === "wikimedia") {
      const file = WIKI_FILES[Math.floor(rng() * WIKI_FILES.length)];
      const pd = rng() < 0.4;
      out.push({ ...base, source: "wikimedia", page_url: `https://commons.wikimedia.org/wiki/File:${file}`, license: pd ? "Public domain" : "CC BY 4.0", license_url: pd ? null : "https://creativecommons.org/licenses/by/4.0/", open_license: true, credit: pd ? "Wikimedia Commons (public domain)" : `${creator} / Wikimedia Commons (CC BY 4.0)` });
    } else {
      out.push({ ...base, source: kind === "page" ? "page" : "og", page_url: page, license: null, license_url: null, open_license: false, credit: opts.sourceName ?? site });
    }
  }
  return out;
}

/** A user-set cover that is not one of the found images. */
export function uploadedImage(url: string): MediaImage {
  return { url, thumb_url: url, page_url: null, source: "upload", license: null, license_url: null, open_license: false, credit: "Uploaded by you", width: null, height: null, hash: null, alt: null };
}
