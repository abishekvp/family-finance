import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import { startActivityAsync } from "expo-intent-launcher";
import * as Notifications from "expo-notifications";
import { api, API_BASE_URL } from "../api/client";

export interface ReleaseInfo {
  version: string;
  apkUrl: string;
  notes: string | null;
}

// Strips the "/api" suffix API_BASE_URL carries; used as the base to resolve apkUrl when it's
// the local dev fallback path rather than a full Vercel Blob URL.
const SERVER_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const APK_MIME = "application/vnd.android.package-archive";
// Intent.FLAG_GRANT_READ_URI_PERMISSION — lets the system package installer read our content:// URI.
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;

export const UPDATE_CHANNEL_ID = "app-updates";
// Fixed identifier so a newer "update available" notification replaces an older one, and so it
// can be cleared once the app is up to date.
export const UPDATE_NOTIFICATION_ID = "app-update-available";

export function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}

export function isNewer(remote: string, local: string): boolean {
  const r = remote.split(".").map(Number);
  const l = local.split(".").map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rp = r[i] ?? 0;
    const lp = l[i] ?? 0;
    if (rp > lp) return true;
    if (rp < lp) return false;
  }
  return false;
}

/** Asks the server for the latest published build; resolves null if it isn't newer than this one. */
export async function fetchNewerRelease(): Promise<ReleaseInfo | null> {
  const res = await api.get<{ latestVersion: string | null; apkUrl: string | null; notes?: string | null }>("/app/version");
  const { latestVersion, apkUrl } = res.data;
  // Nothing published (yet) on this server.
  if (!latestVersion || !apkUrl || !isNewer(latestVersion, currentAppVersion())) return null;
  return { version: latestVersion, apkUrl, notes: res.data.notes ?? null };
}

function resolveApkUrl(release: ReleaseInfo): string {
  // apkUrl is a full Vercel Blob URL once a release has been published (see
  // server/src/routes/app.ts), or the local dev fallback path otherwise — `new URL` resolves
  // either against SERVER_ORIGIN without doubling up. The blob lives at a fixed filename that
  // every release overwrites, so the version query keeps a CDN from handing back the old APK.
  const url = new URL(release.apkUrl, SERVER_ORIGIN);
  url.searchParams.set("v", release.version);
  return url.toString();
}

/**
 * Downloads the release APK into the app cache and hands it to Android's package installer,
 * which shows its own "Update this app?" confirmation (and, the first time, asks the user to
 * allow installs from this app). Anywhere that can't sideload, falls back to opening the URL.
 */
export async function downloadAndInstall(release: ReleaseInfo, onProgress: (fraction: number | null) => void): Promise<void> {
  const url = resolveApkUrl(release);
  if (Platform.OS !== "android") {
    await Linking.openURL(url);
    return;
  }

  const destination = new File(Paths.cache, `family-finance-${release.version}.apk`);
  const apk = await File.downloadFileAsync(url, destination, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => onProgress(totalBytes > 0 ? bytesWritten / totalBytes : null),
  });

  await startActivityAsync("android.intent.action.VIEW", {
    data: apk.contentUri,
    type: APK_MIME,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

// ─── System notification ────────────────────────────────────────────────────

let notificationsReady: Promise<boolean> | null = null;

function ensureNotifications(): Promise<boolean> {
  notificationsReady ??= (async () => {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(UPDATE_CHANNEL_ID, {
        name: "App updates",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  })().catch(() => false);
  return notificationsReady;
}

export async function notifyUpdateAvailable(release: ReleaseInfo): Promise<void> {
  if (!(await ensureNotifications())) return;
  await Notifications.scheduleNotificationAsync({
    identifier: UPDATE_NOTIFICATION_ID,
    content: {
      title: "Update available",
      body: `Family Finance ${release.version} is ready — tap to update.`,
      data: { type: "app-update", version: release.version },
    },
    trigger: Platform.OS === "android" ? { channelId: UPDATE_CHANNEL_ID } : null,
  });
}

export function clearUpdateNotification(): void {
  Notifications.dismissNotificationAsync(UPDATE_NOTIFICATION_ID).catch(() => undefined);
}
