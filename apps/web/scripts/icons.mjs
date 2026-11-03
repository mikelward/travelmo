// Renders the PNG icons installs need from the SVG sources, with the same
// Chromium the end-to-end tests use: `pnpm --filter @travelmo/web icons`.
// The PNGs are committed; rerun this after changing an SVG.
import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputs = [
  { source: "src/app/icon.svg", out: "public/icons/icon-192.png", size: 192 },
  { source: "src/app/icon.svg", out: "public/icons/icon-512.png", size: 512 },
  { source: "icons/maskable.svg", out: "public/icons/maskable-512.png", size: 512 },
  { source: "icons/apple.svg", out: "src/app/apple-icon.png", size: 180 },
];

const browser = await chromium.launch();
try {
  for (const { source, out, size } of outputs) {
    const svg = await readFile(join(root, source), "utf8");
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
    );
    await mkdir(dirname(join(root, out)), { recursive: true });
    await page.screenshot({ path: join(root, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`${out} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
