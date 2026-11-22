"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { setActiveWorkspace } from "./api";
import { useMe } from "./hooks";
import type { Module, WorkspaceLite } from "./platform-types";

export const DEFAULT_BRAND = "#0f766e";

export const INDUSTRIES: { value: string; label: string }[] = [
  { value: "news_media", label: "News & media" },
  { value: "education", label: "Education" },
  { value: "events", label: "Events & hackathons" },
  { value: "executive_media", label: "Executive media" },
  { value: "ecommerce", label: "E-commerce" },
  { value: "blog", label: "Blog / content site" },
  { value: "other", label: "Other" },
];

export function industryLabel(v: string | null | undefined): string {
  return INDUSTRIES.find((i) => i.value === v)?.label ?? (v ? v.replace(/_/g, " ") : "—");
}

/** The active workspace (from /auth/me) plus helpers. */
export function useWorkspace() {
  const me = useMe();
  const t = me.data?.tenant;
  const workspaces: WorkspaceLite[] = me.data?.workspaces ?? (t ? [{ id: t.id, slug: t.slug, name: t.name, industry: t.industry ?? "other", brand_color: t.brand_color ?? DEFAULT_BRAND, modules: t.modules ?? ["newsroom"] }] : []);
  const modules: Module[] = t?.modules ?? ["newsroom"];
  return {
    me: me.data,
    slug: t?.slug ?? null,
    name: t?.name ?? "",
    brand: t?.brand_color || DEFAULT_BRAND,
    modules,
    has: (m: Module) => modules.includes(m),
    workspaces,
    isPlatformAdmin: Boolean(me.data?.user.is_platform_admin),
  };
}

/** Switch workspace: persist the slug, drop every cached query, go home. */
export function useSwitchWorkspace() {
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(
    (slug: string, to = "/") => {
      setActiveWorkspace(slug);
      // Drop cached data of the old workspace, then refetch whatever is on screen (incl. /auth/me).
      qc.removeQueries({ type: "inactive" });
      void qc.resetQueries();
      router.push(to);
    },
    [qc, router],
  );
}
