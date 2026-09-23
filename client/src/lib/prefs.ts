// User preferences for the Transactions/Settings experience. The server is the source of truth
// (so web and mobile agree); localStorage is a synchronous cache that pages read on mount. The
// cache is refreshed from /auth/me on every sign-in / reload, and every change is written through.
import { api } from "../api/client";

export type LandingView = "Daily" | "Calendar";
export type WeekStart = "Sunday" | "Monday";

export interface Prefs {
  defaultView: LandingView;
  weekStart: WeekStart;
  carryOver: boolean;
}

/** The wire format shared with the server and the mobile app. */
export interface ServerPrefs {
  defaultView: "daily" | "calendar";
  weekStart: "sunday" | "monday";
  carryOver: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  defaultView: "Daily",
  weekStart: "Sunday",
  carryOver: true,
};

const PREFS_KEY = "prefs:v1";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    return {
      defaultView: parsed.defaultView === "Calendar" ? "Calendar" : "Daily",
      weekStart: parsed.weekStart === "Monday" ? "Monday" : "Sunday",
      carryOver: typeof parsed.carryOver === "boolean" ? parsed.carryOver : true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function cachePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore write failures (private browsing, storage disabled, etc).
  }
}

/** Saves locally and to the account. */
export function savePrefs(prefs: Prefs) {
  cachePrefs(prefs);
  const body: ServerPrefs = {
    defaultView: prefs.defaultView === "Calendar" ? "calendar" : "daily",
    weekStart: prefs.weekStart === "Monday" ? "monday" : "sunday",
    carryOver: prefs.carryOver,
  };
  api.put("/auth/me/preferences", body).catch(() => undefined);
}

/** Replaces the local cache with the account's saved preferences. */
export function applyServerPrefs(server: ServerPrefs | undefined) {
  if (!server) return;
  cachePrefs({
    defaultView: server.defaultView === "calendar" ? "Calendar" : "Daily",
    weekStart: server.weekStart === "monday" ? "Monday" : "Sunday",
    carryOver: server.carryOver,
  });
}

/** weekStartsOn value for date-fns (0 = Sunday, 1 = Monday). */
export function weekStartsOn(weekStart: WeekStart): 0 | 1 {
  return weekStart === "Monday" ? 1 : 0;
}
