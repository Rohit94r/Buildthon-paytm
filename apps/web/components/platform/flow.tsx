"use client";

import type { RunStep } from "@/lib/platform-types";
import { cn } from "@/components/ui";

export type FlowState = "idle" | "running" | "done" | "failed" | "skipped";

/** State of the connector between `from` (above) and `to` (below). */
export function flowState(from: RunStep | undefined, to: RunStep | undefined): FlowState {
  if (!from && !to) return "idle";
  if (to?.status === "running" || from?.status === "running") return "running";
  if (from?.status === "failed" || to?.status === "failed") return "failed";
  if (to?.status === "skipped") return "skipped";
  if (to && to.status === "succeeded") return "done";
  if (from?.status === "succeeded" && (!to || to.status !== "pending")) return "done";
  return "idle";
}

/** "44 → 19" for the step below, once it has started. */
export function flowLabel(to: RunStep | undefined): string | null {
  if (!to || to.type === "approval" || to.kind === "approval") return null;
  if (to.status === "running") return `${to.items_in} →`;
  if (to.status === "succeeded" || to.status === "failed") return `${to.items_in} → ${to.items_out}`;
  return null;
}

/** Vertical line between two step cards: flowing dots while running, green when done, red on failure, dashed when skipped. */
export function FlowLine({ state, label, className }: { state: FlowState; label?: string | null; className?: string }) {
  return (
    <>
      <span className={cn("flow-line", className)} data-state={state === "idle" ? undefined : state} aria-hidden />
      {label ? (
        <span
          className={cn(
            "absolute top-1/2 left-1/2 z-[1] ml-3 -translate-y-1/2 rounded-full border px-2 py-[1px] text-[11px] font-medium whitespace-nowrap tabular shadow-sm",
            state === "running" ? "border-accent/30 bg-accent-soft text-accent" : state === "failed" ? "border-bad/30 bg-bad-soft text-bad" : "border-ok/30 bg-ok-soft text-ok",
          )}
        >
          {label} items
        </span>
      ) : null}
    </>
  );
}
