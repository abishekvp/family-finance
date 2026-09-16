import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";

export type LandingView = "daily" | "calendar";
export type WeekStart = "sunday" | "monday";

export interface Prefs {
  landingView: LandingView;
  weekStart: WeekStart;
  carryOver: boolean;
}

const PREFS_KEY = "prefs:v1";

export const DEFAULT_PREFS: Prefs = {
  landingView: "daily",
  weekStart: "sunday",
  carryOver: false,
};

interface PrefsContextValue {
  prefs: Prefs;
  isLoading: boolean;
  updatePrefs: (patch: Partial<Prefs>) => Promise<void>;
}

const PrefsContext = createContext<PrefsContextValue | undefined>(undefined);

function isValidPrefs(value: unknown): value is Partial<Prefs> {
  return typeof value === "object" && value !== null;
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(PREFS_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isValidPrefs(parsed)) {
            setPrefs({ ...DEFAULT_PREFS, ...parsed });
          }
        }
      } catch {
        // Corrupt or missing prefs blob — fall back to defaults silently.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const updatePrefs = useCallback(async (patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ prefs, isLoading, updatePrefs }), [prefs, isLoading, updatePrefs]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
