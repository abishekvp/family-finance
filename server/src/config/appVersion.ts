// Single source of truth for where the latest published Android build lives.
//
// `mobile/scripts/upload-apk.js` uploads the release APK plus a small version
// manifest to Vercel Blob Storage after every `npm run build:android:release`
// (see mobile/package.json and the README's "Building an installable APK"
// section). GET /api/app/version reads that manifest so the web download page
// and the in-app update checker always agree on what the latest build is —
// no manual version bump needed here.
export const APK_BLOB_FILENAME = "family-finance.apk";
export const APK_MANIFEST_BLOB_FILENAME = "family-finance-android.json";

// Vercel Blob's public read hostname is derived from the store id, so this
// stays correct even if the store is ever re-created.
export const BLOB_BASE_URL = process.env.ASSET_STORE_ID
  ? `https://${process.env.ASSET_STORE_ID.replace(/^store_/, "").toLowerCase()}.public.blob.vercel-storage.com`
  : null;

// Used when Vercel Blob isn't configured (e.g. local dev without
// ASSET_STORE_ID set) or no release has been uploaded there yet.
export const APP_VERSION_FALLBACK = {
  latest: "1.0.0",
  apkPath: "/downloads/family-finance.apk",
};
