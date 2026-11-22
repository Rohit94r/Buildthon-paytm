// Demo mode: the dashboard runs entirely against the in-memory mock backend in lib/demo/.
// On when NEXT_PUBLIC_DEMO_MODE=true at build time, or localStorage["lf-demo"] === "1".

export const DEMO_KEY = "lf-demo";
export const WORKSPACE_KEY = "lf-workspace";
/** Set once the real /livedesk/status endpoint proves the backend is live. */
export const LIVE_OVERRIDE_KEY = "lf-live";

/** True when the build itself is a demo build (cannot be exited from the UI). */
export const DEMO_FORCED = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export function isDemoMode(): boolean {
  if (typeof window === "undefined") return DEMO_FORCED;
  try {
    // A live API wins over every demo flag, including a build-time NEXT_PUBLIC_DEMO_MODE=true.
    // This makes the fix permanent for the user's real browser profile, not just ours.
    if (window.localStorage.getItem(LIVE_OVERRIDE_KEY) === "1") return false;
  } catch {
    /* storage unavailable */
  }
  if (DEMO_FORCED) return true;
  try {
    return window.localStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return false;
  }
}

/** Called by the boot detector when the real sponsor keys are configured. */
export function forceLiveMode() {
  try {
    window.localStorage.setItem(LIVE_OVERRIDE_KEY, "1");
    window.localStorage.removeItem(DEMO_KEY);
    window.localStorage.setItem(WORKSPACE_KEY, "livedesk");
  } catch {
    /* storage unavailable */
  }
}

export function enterDemo(path = "/") {
  try {
    window.localStorage.removeItem(LIVE_OVERRIDE_KEY);
    window.localStorage.setItem(DEMO_KEY, "1");
    window.localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* storage unavailable: demo still needs the env flag */
  }
  window.location.href = path;
}

export function exitDemo() {
  try {
    window.localStorage.removeItem(DEMO_KEY);
    window.localStorage.removeItem(WORKSPACE_KEY);
  } catch {
    /* ignore */
  }
  window.location.href = "/login";
}

/** Reason string for controls that cannot work without a real backend (e.g. file downloads). */
export const DEMO_UNAVAILABLE = "Not available in demo mode: needs the real backend";
