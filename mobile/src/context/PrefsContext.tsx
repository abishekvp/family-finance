import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { api } from "../api/client";
import { useAuth, type ServerPrefs } from "./AuthContext";

export type LandingView = "daily" | "calendar";
export type WeekStart = "sunday" | "monday";

export interface Prefs {
  landingView: LandingView;
  weekStart: WeekStart;
  carryOver: boolean;
}

// SecureStore keys may only contain [A-Za-z0-9._-]. The old "prefs:v1" key made every read and
// write throw (silently caught), so preferences never survived an app restart.
const PREFS_KEY = "familyFinance.prefs";

export const DEFAULT_PREFS: Prefs = {
  landingView: "daily",
  weekStart: "sunday",
  carryOver: true,
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

function fromServer(server: ServerPrefs): Prefs {
  return { landingView: server.defaultView, weekStart: server.weekStart, carryOver: server.carryOver };
}

/**
 * Preferences live on the account (so the web app and this app agree); SecureStore is a local
 * cache so the right values show instantly on launch and offline.
 */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(() => (user?.preferences ? fromServer(user.preferences) : DEFAULT_PREFS));
  const [isLoading, setIsLoading] = useState(!user?.preferences);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    if (user?.preferences) {
      const next = fromServer(user.preferences);
      setPrefs(next);
      setIsLoading(false);
      SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next)).catch(() => undefined);
      return;
    }
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(PREFS_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isValidPrefs(parsed)) setPrefs({ ...DEFAULT_PREFS, ...parsed });
        }
      } catch {
        // Corrupt or missing prefs blob — fall back to defaults silently.
      } finally {
        setIsLoading(false);
      }
    })();
  }, [user?.preferences]);

  const updatePrefs = useCallback(async (patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next)).catch(() => undefined);
    const body: Partial<ServerPrefs> = {};
    if (patch.landingView) body.defaultView = patch.landingView;
    if (patch.weekStart) body.weekStart = patch.weekStart;
    if (patch.carryOver !== undefined) body.carryOver = patch.carryOver;
    await api.put("/auth/me/preferences", body).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ prefs, isLoading, updatePrefs }), [prefs, isLoading, updatePrefs]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
