#!/usr/bin/env node
/**
 * Rasterises the brand mark in assets-src/ into every size the web PWA and the Expo Android
 * build need. Re-run after editing any source SVG:
 *
 *     npm run icons
 *
 * Outputs are committed so neither build needs sharp installed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (name) => join(root, "assets-src", name);

/** @type {{ from: string, to: string, size: number, background?: string }[]} */
const TARGETS = [
  // ---- Web PWA -----------------------------------------------------------
  { from: "icon.svg", to: "client/public/icons/favicon-32.png", size: 32 },
  { from: "icon.svg", to: "client/public/icons/favicon-180.png", size: 180 },
  { from: "icon.svg", to: "client/public/icons/apple-touch-icon.png", size: 180 },
  { from: "icon.svg", to: "client/public/icons/icon-192.png", size: 192 },
  { from: "icon.svg", to: "client/public/icons/icon-512.png", size: 512 },
  { from: "icon-maskable.svg", to: "client/public/icons/maskable-192.png", size: 192 },
  { from: "icon-maskable.svg", to: "client/public/icons/maskable-512.png", size: 512 },
  // Shown on the "Get the app" page next to the QR code.
  { from: "icon.svg", to: "client/public/icons/icon-256.png", size: 256 },

  // ---- Expo / Android ----------------------------------------------------
  { from: "icon.svg", to: "mobile/assets/icon.png", size: 1024 },
  { from: "icon.svg", to: "mobile/assets/favicon.png", size: 64 },
  { from: "splash-icon.svg", to: "mobile/assets/splash-icon.png", size: 512 },
  { from: "icon-foreground.svg", to: "mobile/assets/android-icon-foreground.png", size: 1024 },
  { from: "icon-monochrome.svg", to: "mobile/assets/android-icon-monochrome.png", size: 1024 },
];

/** The adaptive-icon background layer is a flat gradient with no art. */
async function renderAdaptiveBackground() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 48 48">
    <defs><linearGradient id="g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
      <stop stop-color="#5B46E5"/><stop offset="0.55" stop-color="#8B5CF6"/><stop offset="1" stop-color="#22D3EE"/>
    </linearGradient></defs>
    <rect width="48" height="48" fill="url(#g)"/>
  </svg>`;
  const out = join(root, "mobile/assets/android-icon-background.png");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, await sharp(Buffer.from(svg)).png().toBuffer());
  return out;
}

async function main() {
  for (const target of TARGETS) {
    const out = join(root, target.to);
    await mkdir(dirname(out), { recursive: true });
    const buffer = await sharp(src(target.from), { density: 512 })
      .resize(target.size, target.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(out, buffer);
    console.log(`  ${target.to.padEnd(52)} ${target.size}×${target.size}`);
  }

  const bg = await renderAdaptiveBackground();
  console.log(`  ${bg.replace(root + "\\", "").replace(root + "/", "").padEnd(52)} 1024×1024`);
  console.log(`\nGenerated ${TARGETS.length + 1} icons.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
