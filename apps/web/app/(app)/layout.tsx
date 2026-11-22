"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/components/shell";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { enterDemo } from "@/lib/demo/mode";
import { useMe } from "@/lib/hooks";

export default function AppLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) {
    return (
      <div className="flex min-h-screen" aria-busy="true">
        <div className="hidden w-[248px] border-r border-line bg-bg md:block" />
        <div className="flex-1 space-y-6 px-10 py-10">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }
  if (me.isError) {
    const unreachable = me.error instanceof ApiError && (me.error.status === 0 || me.error.status >= 500);
    if (unreachable) {
      // No backend (e.g. running the dashboard alone on a laptop): the dev proxy answers 500/502.
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-xl font-semibold text-ink">The LayerFlow backend isn&apos;t running</h1>
          <p className="max-w-md text-sm text-muted">
            Start the API and worker to see real data, or explore the full product on sample data. Demo mode runs entirely in
            your browser, so nothing is saved or sent anywhere.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => enterDemo("/")}>
              Explore the live demo
            </Button>
            <Button onClick={() => me.refetch()}>Retry</Button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }
  return <AppShell me={me.data}>{children}</AppShell>;
}
