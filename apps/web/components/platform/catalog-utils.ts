import type { CatalogAgent, CatalogCategory } from "@/lib/platform-ops-types";

/** Shown first in the catalogue and pre-checked as starter agents for new clients. */
export const POPULAR_KEYS = ["smart_scraper", "url_collector", "image_scraper", "comparison_builder", "page_watcher", "content_writer"];

export const CAT_ORDER: CatalogCategory[] = ["collect", "images", "research", "content", "seo", "data", "sales", "publishing", "operations", "support", "assist"];

export const CAT_LABEL: Record<CatalogCategory, string> = {
  collect: "Collect",
  images: "Images",
  research: "Research",
  content: "Content",
  seo: "SEO",
  data: "Data",
  sales: "Sales",
  publishing: "Publishing",
  operations: "Operations",
  support: "Support",
  assist: "Assist",
};

export function popular(items: CatalogAgent[]): CatalogAgent[] {
  return POPULAR_KEYS.map((k) => items.find((i) => i.key === k)).filter((x): x is CatalogAgent => Boolean(x));
}

export function tierLabel(tier: CatalogAgent["pricing"]["tier"]): string {
  return tier === "free" ? "Free" : tier === "pro" ? "Pro" : "Enterprise";
}
