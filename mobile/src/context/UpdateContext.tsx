import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import {
  clearUpdateNotification,
  downloadAndInstall,
  fetchNewerRelease,
  notifyUpdateAvailable,
  type ReleaseInfo,
} from "../lib/appUpdate";
import { SELF_UPDATES } from "../lib/distribution";

export type UpdateStatus = "idle" | "checking" | "upToDate" | "available" | "downloading" | "error";

interface UpdateContextValue {
  status: UpdateStatus;
  release: ReleaseInfo | null;
  /** 0–1 while downloading, or null when the server sent no Content-Length. */
  progress: number | null;
  error: string | null;
  sheetOpen: boolean;
  checkForUpdates: (opts?: { manual?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  /** "Later" — hides the prompt and stops auto-opening it for this version. */
  dismiss: () => void;
}

const DISMISSED_VERSION_KEY = "familyFinance.dismissedUpdateVersion";
const NOTIFIED_VERSION_KEY = "familyFinance.notifiedUpdateVersion";
// Background → foreground re-checks at most this often; launch always checks.
const RECHECK_INTERVAL_MS = 30 * 60 * 1000;

// The in-app sheet already covers a foregrounded app, so only file the notification in the
// shade rather than also popping a heads-up banner over it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const UpdateContext = createContext<UpdateContextValue | undefined>(undefined);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const lastCheckAt = useRef(0);
  // Checks are cheap idempotent reads and may overlap (launch + notification tap), but none may
  // run mid-download or they'd knock the status back to "available".
  const installing = useRef(false);

  const checkForUpdates = useCallback(async ({ manual = false }: { manual?: boolean } = {}) => {
    // A Google Play install is updated by Play, never by the app itself.
    if (!SELF_UPDATES || installing.current) return;
    lastCheckAt.current = Date.now();
    setError(null);
    if (manual) setStatus("checking");

    try {
      const newer = await fetchNewerRelease();
      if (!newer) {
        setRelease(null);
        setStatus("upToDate");
        clearUpdateNotification();
        return;
      }

      setRelease(newer);
      setStatus("available");

      if (manual) {
        setSheetOpen(true);
        return;
      }

      // Post the system notification once per version, so re-launches don't re-buzz.
      const notified = await SecureStore.getItemAsync(NOTIFIED_VERSION_KEY);
      if (notified !== newer.version) {
        await notifyUpdateAvailable(newer).catch(() => undefined);
        await SecureStore.setItemAsync(NOTIFIED_VERSION_KEY, newer.version).catch(() => undefined);
      }

      const dismissed = await SecureStore.getItemAsync(DISMISSED_VERSION_KEY);
      if (dismissed !== newer.version) setSheetOpen(true);
    } catch {
      // Offline or the endpoint is unreachable — only worth surfacing when the user asked.
      if (manual) {
        setStatus("error");
        setError("Couldn't reach the update server. Check your connection and try again.");
      }
    }
  }, []);

  const install = useCallback(async () => {
    if (!release || installing.current) return;
    installing.current = true;
    setError(null);
    setProgress(0);
    setStatus("downloading");
    try {
      await downloadAndInstall(release, setProgress);
      // Back from the system installer: either it's still installing (and will restart us), or
      // the user cancelled — leave the update on offer either way.
      setStatus("available");
    } catch {
      setStatus("error");
      setError("The update couldn't be downloaded. Please try again.");
    } finally {
      installing.current = false;
      setProgress(null);
    }
  }, [release]);

  const dismiss = useCallback(() => {
    setSheetOpen(false);
    if (release) SecureStore.setItemAsync(DISMISSED_VERSION_KEY, release.version).catch(() => undefined);
  }, [release]);

  // Launch check, plus a throttled re-check whenever the app comes back to the foreground.
  useEffect(() => {
    checkForUpdates();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && Date.now() - lastCheckAt.current > RECHECK_INTERVAL_MS) checkForUpdates();
    });
    return () => sub.remove();
  }, [checkForUpdates]);

  // Tapping the "update available" notification (cold start or warm) reopens the prompt, even
  // if the user had previously hit "Later".
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (lastResponse?.notification.request.content.data?.type !== "app-update") return;
    Notifications.clearLastNotificationResponse();
    checkForUpdates({ manual: true });
  }, [lastResponse, checkForUpdates]);

  const value = useMemo(
    () => ({ status, release, progress, error, sheetOpen, checkForUpdates, install, dismiss }),
    [status, release, progress, error, sheetOpen, checkForUpdates, install, dismiss],
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useAppUpdate() {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useAppUpdate must be used within an UpdateProvider");
  return ctx;
}
