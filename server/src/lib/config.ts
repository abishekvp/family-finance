// Public-facing URLs and identifiers used by OAuth redirects, WebAuthn and emails.

/** Origin the web app is served from, e.g. https://finance.abishek.in. */
export function publicAppUrl(): string {
  const fromEnv = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  // Local dev: Vite serves the SPA on 5173 and proxies /api to this server.
  return "http://localhost:5173";
}

/** The Android app's custom-scheme redirect after an OAuth round trip. */
export const MOBILE_OAUTH_REDIRECT = "familyfinance://oauth-callback";

export const ANDROID_PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME?.trim() || "com.anonymous.familyfinance";

/** SHA-256 fingerprints (colon-separated hex, as printed by keytool) of the APK signing certs. */
export function androidCertFingerprints(): string[] {
  return (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function webauthnRpId(): string {
  return process.env.WEBAUTHN_RP_ID?.trim() || new URL(publicAppUrl()).hostname;
}

export const WEBAUTHN_RP_NAME = "Family Finance";

/**
 * Origins a WebAuthn response may come from: the web app itself, plus the Android app, whose
 * Credential Manager reports `android:apk-key-hash:<base64url sha256 of signing cert>`.
 */
export function webauthnOrigins(): string[] {
  const origins = [publicAppUrl()];
  for (const extra of (process.env.WEBAUTHN_EXTRA_ORIGINS ?? "").split(",")) {
    if (extra.trim()) origins.push(extra.trim());
  }
  for (const fp of androidCertFingerprints()) {
    const bytes = Buffer.from(fp.replace(/:/g, ""), "hex");
    origins.push(`android:apk-key-hash:${bytes.toString("base64url")}`);
  }
  return origins;
}
