import { Router } from "express";
import {
  APK_BLOB_FILENAME,
  APK_MANIFEST_BLOB_FILENAME,
  APP_VERSION_FALLBACK,
  BLOB_BASE_URL,
} from "../config/appVersion";

export const appRouter = Router();

// Polled by the mobile app's UpdateChecker and by the web "Get the app" page.
appRouter.get("/version", async (_req, res) => {
  // Poll-heavy endpoint; a short cache keeps launch spikes cheap while still
  // surfacing a new release within a minute.
  res.setHeader("Cache-Control", "public, max-age=60");

  if (!BLOB_BASE_URL) {
    res.json({ latestVersion: APP_VERSION_FALLBACK.latest, apkUrl: APP_VERSION_FALLBACK.apkPath });
    return;
  }

  const apkUrl = `${BLOB_BASE_URL}/${APK_BLOB_FILENAME}`;

  try {
    const manifestRes = await fetch(`${BLOB_BASE_URL}/${APK_MANIFEST_BLOB_FILENAME}`, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!manifestRes.ok) throw new Error(`manifest responded ${manifestRes.status}`);

    const manifest = (await manifestRes.json()) as { versionName?: string };
    res.json({ latestVersion: manifest.versionName ?? APP_VERSION_FALLBACK.latest, apkUrl });
  } catch {
    // No manifest uploaded yet — still point at the blob APK if one exists,
    // just without a version number to compare against.
    res.json({ latestVersion: APP_VERSION_FALLBACK.latest, apkUrl });
  }
});
