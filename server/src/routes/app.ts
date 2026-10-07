import { Router } from "express";
import { APK_BLOB_FILENAME, APK_MANIFEST_BLOB_FILENAME, BLOB_BASE_URL, PLAY_STORE_URL } from "../config/appVersion";

export const appRouter = Router();

interface VersionInfo {
  /** Null when no build has been published, so there's nothing to compare against or download. */
  latestVersion: string | null;
  apkUrl: string | null;
  notes: string | null;
  releasedAt: string | null;
  playStoreUrl: string | null;
}

// Polled by the mobile app's UpdateChecker and by the web "Get the app" page.
appRouter.get("/version", async (_req, res) => {
  // Poll-heavy endpoint; a short cache keeps launch spikes cheap while still
  // surfacing a new release within a minute.
  res.setHeader("Cache-Control", "public, max-age=60");

  const info: VersionInfo = { latestVersion: null, apkUrl: null, notes: null, releasedAt: null, playStoreUrl: PLAY_STORE_URL };
  if (!BLOB_BASE_URL) {
    res.json(info);
    return;
  }

  try {
    const manifestRes = await fetch(`${BLOB_BASE_URL}/${APK_MANIFEST_BLOB_FILENAME}`, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(5000),
    });
    if (!manifestRes.ok) throw new Error(`manifest responded ${manifestRes.status}`);

    const manifest = (await manifestRes.json()) as {
      versionName?: string;
      notes?: string | null;
      releasedAt?: string;
    };
    res.json({
      ...info,
      latestVersion: manifest.versionName ?? null,
      apkUrl: `${BLOB_BASE_URL}/${APK_BLOB_FILENAME}`,
      notes: manifest.notes ?? null,
      releasedAt: manifest.releasedAt ?? null,
    });
  } catch {
    // No manifest uploaded yet (or Blob unreachable): nothing to offer.
    res.json(info);
  }
});
