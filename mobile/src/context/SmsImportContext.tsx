import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { ensureReceiveSmsPermission, isSmsReaderAvailable, requestSmsPermission } from "../../modules/sms-reader";
import {
  DEFAULT_SMS_SETTINGS,
  loadSmsSettings,
  patchSmsSettings,
  runSmsHistoryImport,
  runSmsSync,
  type SmsHistoryResult,
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
  isImportingHistory: boolean;
  historyResult: SmsHistoryResult | null;
  /** Bumps whenever a sync records something, so transaction lists can refetch. */
  syncVersion: number;
  /**
   * Asks for READ_SMS, then turns import on for messages from now on — nothing is scanned yet.
   * Past messages are a separate, optional `importHistory`. Resolves false if permission was refused.
   */
  enable: (opts: { defaultAccountId: string }) => Promise<boolean>;
  disable: () => Promise<void>;
  updateSettings: (patch: Partial<Pick<SmsImportSettings, "defaultAccountId" | "accountMap">>) => Promise<void>;
  syncNow: () => Promise<void>;
  /** Records alerts from the `days` before import was turned on. */
  importHistory: (days: number) => Promise<void>;
}

// Foreground re-scans at most this often; launch always scans.
const RESYNC_INTERVAL_MS = 60 * 1000;

const SmsImportContext = createContext<SmsImportContextValue | undefined>(undefined);

export function SmsImportProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const familyId = user?.families[0]?.id ?? null;
  const available = isSmsReaderAvailable();

  const [settings, setSettings] = useState<SmsImportSettings>(DEFAULT_SMS_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SmsSyncResult | null>(null);
  const [isImportingHistory, setIsImportingHistory] = useState(false);
  const [historyResult, setHistoryResult] = useState<SmsHistoryResult | null>(null);
  const [syncVersion, setSyncVersion] = useState(0);
  // Syncs read settings across awaits; the ref keeps them off stale closures.
  const settingsRef = useRef(settings);
  const syncing = useRef<Promise<void> | null>(null);
  const importingHistory = useRef<Promise<void> | null>(null);
  // Turning import on shouldn't trigger the launch-time scan that `settings.enabled` flipping would.
  const skipNextAutoScan = useRef(false);

  const show = useCallback((next: SmsImportSettings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  // The SMS wake-up and the background sync scan while the app is closed, so the stored settings are
  // the truth: changes are written on top of them (see patchSmsSettings), never from this copy.
  const persist = useCallback(
    async (patch: Partial<SmsImportSettings>) => {
      if (!familyId) return;
      show(await patchSmsSettings(familyId, patch));
    },
    [familyId, show]
  );

  useEffect(() => {
    if (!familyId || !available) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    loadSmsSettings(familyId).then((loaded) => {
      if (cancelled) return;
      show(loaded);
      setIsLoading(false);
      // Builds from before the SMS wake-up only asked for READ_SMS; without RECEIVE_SMS new alerts
      // are only picked up when the app is opened.
      if (loaded.enabled) ensureReceiveSmsPermission().catch(() => undefined);
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
        const { settings: next, result } = await runSmsSync(familyId);
        show(next);
        setLastResult(result);
        if (result.imported > 0) setSyncVersion((v) => v + 1);
      } finally {
        setIsSyncing(false);
        syncing.current = null;
      }
    })();
    return syncing.current;
  }, [familyId, show]);

  const importHistory = useCallback(
    async (days: number) => {
      if (!familyId || !settingsRef.current.enabled) return;
      if (importingHistory.current) return importingHistory.current;
      importingHistory.current = (async () => {
        setIsImportingHistory(true);
        setHistoryResult(null);
        try {
          const { settings: next, result } = await runSmsHistoryImport(familyId, days);
          show(next);
          setHistoryResult(result);
          if (result.imported > 0) setSyncVersion((v) => v + 1);
        } finally {
          setIsImportingHistory(false);
          importingHistory.current = null;
        }
      })();
      return importingHistory.current;
    },
    [familyId, show]
  );

  const enable = useCallback(
    async ({ defaultAccountId }: { defaultAccountId: string }) => {
      if (!familyId) return false;
      const granted = await requestSmsPermission();
      if (!granted) return false;
      const now = Date.now();
      skipNextAutoScan.current = true;
      // Start from now in both directions: new alerts are picked up on the next launch or return
      // to the app, and past ones only if the user asks for them.
      await persist({
        enabled: true,
        familyId,
        defaultAccountId,
        since: now,
        historyFrom: now,
        lastRunAt: null,
      });
      setLastResult(null);
      setHistoryResult(null);
      return true;
    },
    [familyId, persist]
  );

  const disable = useCallback(async () => {
    await persist({ enabled: false });
    setLastResult(null);
    setHistoryResult(null);
  }, [persist]);

  const updateSettings = useCallback(
    async (patch: Partial<Pick<SmsImportSettings, "defaultAccountId" | "accountMap">>) => {
      await persist(patch);
    },
    [persist]
  );

  // Scan on launch, then whenever the app returns to the foreground.
  useEffect(() => {
    if (isLoading || !settings.enabled) return;
    if (skipNextAutoScan.current) skipNextAutoScan.current = false;
    else syncNow();
    const sub = AppState.addEventListener("change", (state) => {
      const lastRunAt = settingsRef.current.lastRunAt ?? 0;
      if (state === "active" && Date.now() - lastRunAt > RESYNC_INTERVAL_MS) syncNow();
    });
    return () => sub.remove();
  }, [isLoading, settings.enabled, syncNow]);

  const value = useMemo(
    () => ({
      available,
      settings,
      isLoading,
      isSyncing,
      lastResult,
      isImportingHistory,
      historyResult,
      syncVersion,
      enable,
      disable,
      updateSettings,
      syncNow,
      importHistory,
    }),
    [
      available,
      settings,
      isLoading,
      isSyncing,
      lastResult,
      isImportingHistory,
      historyResult,
      syncVersion,
      enable,
      disable,
      updateSettings,
      syncNow,
      importHistory,
    ]
  );

  return <SmsImportContext.Provider value={value}>{children}</SmsImportContext.Provider>;
}

export function useSmsImport() {
  const ctx = useContext(SmsImportContext);
  if (!ctx) throw new Error("useSmsImport must be used within an SmsImportProvider");
  return ctx;
}
