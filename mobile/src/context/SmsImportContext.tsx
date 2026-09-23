import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { isSmsReaderAvailable, requestSmsPermission } from "../../modules/sms-reader";
import {
  DEFAULT_SMS_SETTINGS,
  loadSmsSettings,
  saveSmsSettings,
  syncSmsTransactions,
  type SmsImportSettings,
  type SmsSyncResult,
} from "../lib/smsImport";
import { useAuth } from "./AuthContext";

interface SmsImportContextValue {
  /** False on iOS and on builds that predate the native SMS reader. */
  available: boolean;
  settings: SmsImportSettings;
  isLoading: boolean;
  isSyncing: boolean;
  lastResult: SmsSyncResult | null;
  /** Bumps whenever a sync records something, so transaction lists can refetch. */
  syncVersion: number;
  /** Asks for READ_SMS, then turns import on. Resolves false if the permission was refused. */
  enable: (opts: { defaultAccountId: string; historyDays: number }) => Promise<boolean>;
  disable: () => Promise<void>;
  updateSettings: (patch: Partial<Pick<SmsImportSettings, "defaultAccountId" | "accountMap">>) => Promise<void>;
  syncNow: () => Promise<void>;
}

// Foreground re-scans at most this often; launch always scans.
const RESYNC_INTERVAL_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SmsImportContext = createContext<SmsImportContextValue | undefined>(undefined);

export function SmsImportProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const familyId = user?.families[0]?.id ?? null;
  const available = isSmsReaderAvailable();

  const [settings, setSettings] = useState<SmsImportSettings>(DEFAULT_SMS_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SmsSyncResult | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  // Syncs read and write settings across awaits; the ref keeps them off stale closures.
  const settingsRef = useRef(settings);
  const syncing = useRef<Promise<void> | null>(null);

  const persist = useCallback(async (next: SmsImportSettings) => {
    settingsRef.current = next;
    setSettings(next);
    await saveSmsSettings(next);
  }, []);

  useEffect(() => {
    if (!familyId || !available) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    loadSmsSettings(familyId).then((loaded) => {
      if (cancelled) return;
      settingsRef.current = loaded;
      setSettings(loaded);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [familyId, available]);

  const syncNow = useCallback(async () => {
    if (!familyId || !settingsRef.current.enabled) return;
    // Launch, foreground and "Scan now" can race; they share one run.
    if (syncing.current) return syncing.current;
    syncing.current = (async () => {
      setIsSyncing(true);
      try {
        const { settings: next, result } = await syncSmsTransactions(familyId, settingsRef.current);
        // The user may have toggled import or remapped accounts while this ran — keep those choices.
        const { enabled, defaultAccountId, accountMap } = settingsRef.current;
        await persist({ ...next, enabled, defaultAccountId, accountMap });
        setLastResult(result);
        if (result.imported > 0) setSyncVersion((v) => v + 1);
      } finally {
        setIsSyncing(false);
        syncing.current = null;
      }
    })();
    return syncing.current;
  }, [familyId, persist]);

  const enable = useCallback(
    async ({ defaultAccountId, historyDays }: { defaultAccountId: string; historyDays: number }) => {
      if (!familyId) return false;
      const granted = await requestSmsPermission();
      if (!granted) return false;
      await persist({
        ...settingsRef.current,
        enabled: true,
        familyId,
        defaultAccountId,
        since: Date.now() - historyDays * DAY_MS,
        recent: [],
      });
      setLastResult(null);
      await syncNow();
      return true;
    },
    [familyId, persist, syncNow]
  );

  const disable = useCallback(async () => {
    await persist({ ...settingsRef.current, enabled: false });
    setLastResult(null);
  }, [persist]);

  const updateSettings = useCallback(
    async (patch: Partial<Pick<SmsImportSettings, "defaultAccountId" | "accountMap">>) => {
      await persist({ ...settingsRef.current, ...patch });
    },
    [persist]
  );

  // Scan on launch, then whenever the app returns to the foreground.
  useEffect(() => {
    if (isLoading || !settings.enabled) return;
    syncNow();
    const sub = AppState.addEventListener("change", (state) => {
      const lastRunAt = settingsRef.current.lastRunAt ?? 0;
      if (state === "active" && Date.now() - lastRunAt > RESYNC_INTERVAL_MS) syncNow();
    });
    return () => sub.remove();
  }, [isLoading, settings.enabled, syncNow]);

  const value = useMemo(
    () => ({ available, settings, isLoading, isSyncing, lastResult, syncVersion, enable, disable, updateSettings, syncNow }),
    [available, settings, isLoading, isSyncing, lastResult, syncVersion, enable, disable, updateSettings, syncNow]
  );

  return <SmsImportContext.Provider value={value}>{children}</SmsImportContext.Provider>;
}

export function useSmsImport() {
  const ctx = useContext(SmsImportContext);
  if (!ctx) throw new Error("useSmsImport must be used within an SmsImportProvider");
  return ctx;
}
