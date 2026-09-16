// Local-only user preferences for the Transactions/Settings experience.
// These have no backend model — persisted to localStorage under a single JSON blob.
// (Mobile persists the same shape to expo-secure-store under the same key.)

export type LandingView = "Daily" | "Calendar";
export type WeekStart = "Sunday" | "Monday";

export interface Prefs {
  defaultView: LandingView;
  weekStart: WeekStart;
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

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore write failures (private browsing, storage disabled, etc).
  }
}

/** weekStartsOn value for date-fns (0 = Sunday, 1 = Monday). */
export function weekStartsOn(weekStart: WeekStart): 0 | 1 {
  return weekStart === "Monday" ? 1 : 0;
}
