import type { ManagedAgent } from "@/lib/platform-ops-types";

/** One status for an agent card/header: live run beats lifecycle status. */
export function agentStatus(a: ManagedAgent): { tone: "live" | "ok" | "warn" | "bad" | "neutral"; label: string } {
  if (a.live) return { tone: "live", label: "Running" };
  if (a.status === "paused") return { tone: "warn", label: "Paused" };
  if (a.status === "disabled") return { tone: "neutral", label: "Disabled" };
  if (a.last_error && a.stats.success_rate !== null && a.stats.success_rate < 0.8) return { tone: "bad", label: "Failing" };
  return { tone: "ok", label: a.schedule.every_minutes ? "Scheduled" : "Idle" };
}
