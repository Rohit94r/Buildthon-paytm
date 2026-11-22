// Demo mode: the dashboard runs entirely against the in-memory mock backend in lib/demo/.
// On when NEXT_PUBLIC_DEMO_MODE=true at build time, or localStorage["lf-demo"] === "1".

export const DEMO_KEY = "lf-demo";
export const WORKSPACE_KEY = "lf-workspace";

/** True when the build itself is a demo build (cannot be exited from the UI). */
export const DEMO_FORCED = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

export function isDemoMode(): boolean {
  if (DEMO_FORCED) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return false;
  }
}

export function enterDemo(path = "/") {
  try {
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
