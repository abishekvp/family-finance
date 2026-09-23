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

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_JSON = path.join(ROOT, "mobile", "app.json");

function parseArgs(argv) {
  const out = { notes: null, bump: "patch" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--notes" || arg === "-m") out.notes = argv[++i] ?? "";
    else if (arg.startsWith("--notes=")) out.notes = arg.slice("--notes=".length);
    else if (arg === "--bump") out.bump = argv[++i];
    else if (arg.startsWith("--bump=")) out.bump = arg.slice("--bump=".length);
    else {
      console.error(`[release] Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (!["patch", "minor", "major"].includes(out.bump)) {
    console.error(`[release] --bump must be patch, minor or major (got "${out.bump}")`);
    process.exit(1);
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
  const notes = (args.notes ?? process.env.ANDROID_RELEASE_NOTES ?? "").trim() || (await askForNotes());

  // Web first: it's the quick one, so a broken build fails before the version is touched.
  if (!run("npm run build")) {
    console.error("[release] Web build failed — app version left unchanged.");
    process.exit(1);
  }

  const original = fs.readFileSync(APP_JSON, "utf8");
  const appJson = JSON.parse(original);
  const fromVersion = appJson.expo.version;
  const fromCode = Number(appJson.expo.android.versionCode ?? 0);
  appJson.expo.version = bumpVersion(fromVersion, args.bump);
  appJson.expo.android.versionCode = fromCode + 1;
  fs.writeFileSync(APP_JSON, JSON.stringify(appJson, null, 2) + "\n");
  console.log(
    `\n[release] Android version ${fromVersion} (${fromCode}) → ${appJson.expo.version} (${appJson.expo.android.versionCode})`,
  );

  if (!run("npm run build:android", { ...process.env, ANDROID_RELEASE_NOTES: notes })) {
    // Restore so a re-run doesn't skip a version number that was never published.
    fs.writeFileSync(APP_JSON, original);
    console.error(`[release] Android build/upload failed — app.json restored to ${fromVersion} (${fromCode}).`);
    process.exit(1);
  }

  console.log(`\n[release] Published Android ${appJson.expo.version}. Web build is in client/dist + server/dist.`);
  console.log("[release] Commit mobile/app.json so the version bump isn't lost.");
}

main();
