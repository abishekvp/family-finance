// Single source of truth for the latest published Android build. Bump `latest` (and mobile's
// app.json "version"/"versionCode") whenever a new APK is built and uploaded to
// client/public/downloads/family-finance.apk — the mobile app polls GET /api/app/version and
// prompts installed users to update when it's ahead of their running version.
export const APP_VERSION = {
  latest: "1.0.0",
  apkPath: "/downloads/family-finance.apk",
};
