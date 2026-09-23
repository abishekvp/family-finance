#!/usr/bin/env node
// Uploads the freshly built Android APK to Vercel Blob Storage so the
// "Download APK" link on the web app (and the in-app update checker) always
// serve the latest build. Run as a postbuild hook after
// `npm run build:android:release` (see mobile/package.json).

const fs = require('fs');
const path = require('path');

const VARIANT = process.argv[2] || 'release';
const OUTPUTS_DIR = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk');
const BLOB_FILENAME = 'family-finance.apk';
// Polled by the server's GET /api/app/version so installed copies of the app
// and the web download page always agree on what the latest build is.
const MANIFEST_FILENAME = 'family-finance-android.json';
const APP_JSON = path.join(__dirname, '..', 'app.json');

// Load the repo-root .env if present (ASSET_STORE_ID / BLOB_READ_WRITE_TOKEN live there).
try {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  }
} catch { /* ignore */ }

/**
 * Reads version/versionCode straight out of app.json — the one place Expo
 * already requires them (`expo.version` / `expo.android.versionCode`) — so
 * nothing here needs to be kept in sync by hand.
 */
function readAppVersion() {
  const appJson = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
  const versionName = appJson.expo?.version;
  const versionCode = appJson.expo?.android?.versionCode;
  if (!versionName || !versionCode) {
    throw new Error(`[upload-apk] Could not find expo.version / expo.android.versionCode in ${APP_JSON}`);
  }
  return { versionCode: Number(versionCode), versionName: String(versionName) };
}

function findApks(dir) {
  if (!fs.existsSync(dir)) return [];
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(findApks(full));
    } else if (entry.isFile() && entry.name.endsWith('.apk')) {
      out.push(full);
    }
  }
  return out;
}

// ─── Upload to Vercel Blob ──────────────────────────────────────────────────

/** How many times to attempt a single upload before giving up. */
const MAX_ATTEMPTS = 4;

/**
 * Whether a failure is worth another go.
 *
 * The APK can be tens of MB, and a PUT that size over TLS gets its connection
 * reset often enough to matter (ECONNRESET / ETIMEDOUT surface as `fetch
 * failed` with the socket error tucked into `cause`). Those are worth
 * retrying. A 4xx is not — a bad token or a rejected name will fail
 * identically forever.
 */
function isRetryable(err) {
  if (err instanceof HttpError) return err.status >= 500 || err.status === 429;
  const code = err?.cause?.code || err?.code;
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
}

class HttpError extends Error {
  constructor(status, body) {
    super(`Blob upload failed (${status}): ${body}`);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function putBlob(filename, body, contentType) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('[upload-apk] BLOB_READ_WRITE_TOKEN not set — cannot upload.');
    process.exit(1);
  }

  const url = `https://blob.vercel-storage.com/${filename}`;

  for (let attempt = 1; ; attempt++) {
    try {
      // `body` is a Buffer already in memory, so a retry re-sends the same
      // bytes — there is no consumed stream to rewind.
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-add-random-suffix': '0',
          'content-type': contentType,
        },
        body,
      });

      if (!res.ok) throw new HttpError(res.status, await res.text());

      const data = await res.json();
      return data.url;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) throw err;
      const backoffMs = 2000 * 2 ** (attempt - 1);
      const reason = err?.cause?.code || err?.code || err.message;
      console.warn(
        `[upload-apk] ${filename}: attempt ${attempt}/${MAX_ATTEMPTS} failed (${reason}); ` +
          `retrying in ${backoffMs / 1000}s`,
      );
      await sleep(backoffMs);
    }
  }
}

async function uploadToBlob(filename, filePath) {
  return putBlob(filename, fs.readFileSync(filePath), 'application/vnd.android.package-archive');
}

async function main() {
  const preferredDir = path.join(OUTPUTS_DIR, VARIANT);
  let candidates = findApks(preferredDir);

  if (candidates.length === 0) {
    // Fall back to any apk under outputs/apk, preferring the most recently built.
    candidates = findApks(OUTPUTS_DIR);
  }

  if (candidates.length === 0) {
    console.error(`[upload-apk] No .apk found under ${OUTPUTS_DIR}. Did the Gradle build succeed?`);
    process.exit(1);
  }

  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const source = candidates[0];

  console.log(`[upload-apk] Found APK: ${path.relative(process.cwd(), source)}`);

  const blobUrl = await uploadToBlob(BLOB_FILENAME, source);
  console.log(`[upload-apk] Uploaded to Vercel Blob: ${blobUrl}`);

  // The manifest goes up AFTER the APK, never before: a client that polls in
  // between must not be told about a build it cannot download yet.
  const { versionCode, versionName } = readAppVersion();
  const manifest = {
    versionCode,
    versionName,
    variant: VARIANT,
    releasedAt: new Date().toISOString(),
    notes: process.env.ANDROID_RELEASE_NOTES || null,
  };
  const manifestUrl = await putBlob(
    MANIFEST_FILENAME,
    Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    'application/json'
  );
  console.log(`[upload-apk] Published update manifest v${versionName} (${versionCode}): ${manifestUrl}`);
}

main();
