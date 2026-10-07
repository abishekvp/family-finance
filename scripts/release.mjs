#!/usr/bin/env node
// `npm run build:all` — builds the web app, then bumps the Android app's version and builds +
// publishes a release APK (mobile's postbuild hook uploads it to Vercel Blob, which is what the
// in-app update checker and /get-the-app read).
//
//   npm run build:all -- --notes "Fixed the budget rollover bug"
//   npm run build:all -- --bump minor            # default is patch; minor | major also accepted
//
// Release notes are required: pass --notes (or -m), set ANDROID_RELEASE_NOTES, or type them when
// prompted. They're shown to users in the "Update available" prompt.
//
// `npm run build:play` — builds the Google Play bundle (.aab) instead: no self-updater, signed with
// your upload key (ANDROID_UPLOAD_KEYSTORE & co., read from the repo-root .env or the environment),
// nothing uploaded anywhere. It builds the version already in mobile/app.json — normally the one the
// last `build:all` published — unless you pass --bump. Upload the .aab in the Play Console.
//
//   npm run build:play
//   npm run build:play -- --bump patch           # a Play-only release
//   npm run build:play -- --no-sms               # a build without SMS import (and its permissions)

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_JSON = path.join(ROOT, "mobile", "app.json");
const AAB = path.join(ROOT, "mobile", "android", "app", "build", "outputs", "bundle", "release", "app-release.aab");
const UPLOAD_KEY_VARS = ["ANDROID_UPLOAD_KEYSTORE", "ANDROID_UPLOAD_KEYSTORE_PASSWORD", "ANDROID_UPLOAD_KEY_ALIAS", "ANDROID_UPLOAD_KEY_PASSWORD"];

function parseArgs(argv) {
  const out = { notes: null, bump: null, play: false, sms: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--notes" || arg === "-m") out.notes = argv[++i] ?? "";
    else if (arg.startsWith("--notes=")) out.notes = arg.slice("--notes=".length);
    else if (arg === "--bump") out.bump = argv[++i];
    else if (arg.startsWith("--bump=")) out.bump = arg.slice("--bump=".length);
    else if (arg === "--play") out.play = true;
    else if (arg === "--no-sms") out.sms = false;
    else {
      console.error(`[release] Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (out.bump !== null && !["patch", "minor", "major"].includes(out.bump)) {
    console.error(`[release] --bump must be patch, minor or major (got "${out.bump}")`);
    process.exit(1);
  }
  // A website release always bumps (the in-app updater compares versions); a Play build only when asked.
  if (!out.play && out.bump === null) out.bump = "patch";
  return out;
}

/** KEY=value lines from the repo-root .env, without overriding anything already in the environment. */
function loadRootEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] === undefined) out[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

async function askForNotes() {
  if (!process.stdin.isTTY) {
    console.error('[release] Release notes are required. Re-run with --notes "..." or set ANDROID_RELEASE_NOTES.');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("Release notes for this app version (finish with an empty line):");
  const lines = [];
  for (;;) {
    const line = await rl.question(lines.length ? "  " : "> ");
    if (!line.trim()) {
      if (lines.length) break;
      console.log("Release notes can't be empty.");
      continue;
    }
    lines.push(line.trim());
  }
  rl.close();
  return lines.join("\n");
}

function bumpVersion(version, kind) {
  const [major, minor, patch] = version.split(".").map((n) => Number(n) || 0);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function run(command, env = process.env) {
  console.log(`\n[release] $ ${command}`);
  const result = spawnSync(command, { cwd: ROOT, stdio: "inherit", shell: true, env });
  return result.status === 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fileEnv = loadRootEnv();

  let env = { ...process.env };
  if (args.play) {
    const signing = Object.fromEntries(UPLOAD_KEY_VARS.map((k) => [k, process.env[k] ?? fileEnv[k]]).filter(([, v]) => v));
    const missing = UPLOAD_KEY_VARS.filter((k) => k !== "ANDROID_UPLOAD_KEY_PASSWORD" && !signing[k]);
    if (missing.length > 0) {
      console.error(`[release] The Play build is signed with your upload key. Set ${missing.join(", ")} (in the repo-root .env or the environment).`);
      process.exit(1);
    }
    if (!fs.existsSync(signing.ANDROID_UPLOAD_KEYSTORE)) {
      console.error(`[release] ANDROID_UPLOAD_KEYSTORE points at ${signing.ANDROID_UPLOAD_KEYSTORE}, which doesn't exist.`);
      process.exit(1);
    }
    env = { ...env, ...signing, APP_CHANNEL: "play", ...(args.sms ? {} : { APP_SMS: "off" }) };
  } else {
    const notes = (args.notes ?? process.env.ANDROID_RELEASE_NOTES ?? "").trim() || (await askForNotes());
    env = { ...env, APP_CHANNEL: "direct", ANDROID_RELEASE_NOTES: notes };
  }

  // Web first: it's the quick one, so a broken build fails before the version is touched.
  if (!run("npm run build")) {
    console.error("[release] Web build failed — app version left unchanged.");
    process.exit(1);
  }

  const original = fs.readFileSync(APP_JSON, "utf8");
  const appJson = JSON.parse(original);
  const fromVersion = appJson.expo.version;
  const fromCode = Number(appJson.expo.android.versionCode ?? 0);
  if (args.bump) {
    appJson.expo.version = bumpVersion(fromVersion, args.bump);
    appJson.expo.android.versionCode = fromCode + 1;
    fs.writeFileSync(APP_JSON, JSON.stringify(appJson, null, 2) + "\n");
    console.log(
      `\n[release] Android version ${fromVersion} (${fromCode}) → ${appJson.expo.version} (${appJson.expo.android.versionCode})`,
    );
  }

  const script = args.play ? "build:android:play" : "build:android";
  if (!run(`npm run ${script} --prefix mobile`, env)) {
    // Restore so a re-run doesn't skip a version number that was never published.
    if (args.bump) fs.writeFileSync(APP_JSON, original);
    console.error(`[release] Android build failed — app.json ${args.bump ? `restored to ${fromVersion} (${fromCode})` : "unchanged"}.`);
    process.exit(1);
  }

  if (args.play) {
    console.log(`\n[release] Play bundle for ${appJson.expo.version} (${appJson.expo.android.versionCode}): ${path.relative(ROOT, AAB)}`);
    console.log("[release] Upload it in the Play Console (Release → Testing or Production → Create new release).");
  } else {
    console.log(`\n[release] Published Android ${appJson.expo.version}. Web build is in client/dist + server/dist.`);
  }
  if (args.bump) console.log("[release] Commit mobile/app.json so the version bump isn't lost.");
}

main();
