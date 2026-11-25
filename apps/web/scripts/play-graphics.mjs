// Renders the Play listing's feature graphic and phone screenshots into
// apps/android/play/listings/en-US with the Chromium the end-to-end tests
// use: `pnpm --filter @travelmo/web play-graphics`. The screenshots frame
// the Android app's recorded snapshots (apps/android/app/snapshots), so
// rerun this after re-recording them; the PNGs are committed.
import { chromium } from "@playwright/test";
import { readFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const play = join(repo, "apps/android/play");
const out = join(play, "listings/en-US");
const snapshots = join(repo, "apps/android/app/snapshots");

const ORANGE = "#F26B1D";
// Fira Sans (SIL Open Font License, from @fontsource/fira-sans), embedded
// so every machine renders the same: a humanist face whose tailed l keeps
// "Travelmo" reading as one word.
const FONT = "'Fira Sans', sans-serif";
const fontFiles = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules/@fontsource/fira-sans/files");
const fontFaces = (
  await Promise.all(
    [400, 700].map(async weight => {
      const woff2 = await readFile(join(fontFiles, `fira-sans-latin-${weight}-normal.woff2`));
      return `@font-face{font-family:'Fira Sans';font-weight:${weight};src:url(data:font/woff2;base64,${woff2.toString("base64")}) format('woff2')}`;
    }),
  )
).join("");

// Snapshot, caption: the order they appear in on Play.
const SCREENSHOTS = [
  // Its own snapshot, so the first screenshot shows off the landmarks rather than warnings.
  ["trip_list_cities", "Every trip, now and next"],
  ["trip_detail", "Bookings arrive from your inbox"],
  ["trip_detail_shared", "Share a trip by email"],
  ["calendar", "Your travel, month by month"],
  ["reports", "Where you've been, year by year"],
  ["profile", "Passports and loyalty programs"],
];

// The mark from the Play icon (its <g>), so the graphic and the icon match.
const iconSvg = await readFile(join(play, "icon.svg"), "utf8");
const mark = iconSvg.match(/<g [\s\S]*<\/g>/)?.[0];
if (!mark) throw new Error("No <g> mark found in apps/android/play/icon.svg");

const featureGraphic = `
  <div style="width:1024px;height:500px;background:${ORANGE};display:flex;align-items:center;gap:36px;padding:0 72px;box-sizing:border-box;font-family:${FONT};color:#fff">
    <svg viewBox="0 0 512 512" width="300" height="300" style="flex:none">${mark}</svg>
    <div>
      <div style="font-size:108px;font-weight:700;letter-spacing:-1px;line-height:1">Travelmo</div>
      <div style="font-size:34px;font-weight:400;line-height:1.3;margin-top:20px;max-width:520px">Your trips in one place, imported from your inbox.</div>
    </div>
  </div>`;

const screenshot = (png, caption) => `
  <div style="width:1080px;height:2160px;background:${ORANGE};display:flex;flex-direction:column;align-items:center;font-family:${FONT};color:#fff;box-sizing:border-box;padding-top:150px">
    <div style="font-size:76px;font-weight:700;line-height:1.1;text-align:center;max-width:900px;height:180px">${caption}</div>
    <div style="margin-top:70px;background:#171717;padding:16px;border-radius:64px;box-shadow:0 30px 80px rgba(0,0,0,.28)">
      <img src="data:image/png;base64,${png.toString("base64")}" style="display:block;width:740px;border-radius:48px">
    </div>
  </div>`;

async function render(browser, html, width, height, path) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<html><head><style>${fontFaces}</style></head><body style="margin:0">${html}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, clip: { x: 0, y: 0, width, height } });
    console.log(`${path.slice(repo.length + 1)} (${width}x${height})`);
  } finally {
    await page.close();
  }
}

console.log("play-graphics: rendering the Play listing graphics");
const browser = await chromium.launch();
try {
  await render(browser, featureGraphic, 1024, 500, join(out, "feature-graphic.png"));
  const made = new Set();
  for (const [i, [name, caption]] of SCREENSHOTS.entries()) {
    const png = await readFile(join(snapshots, `${name}.png`));
    const file = `${String(i + 1).padStart(2, "0")}-${name.replaceAll("_", "-")}.png`;
    await render(browser, screenshot(png, caption), 1080, 2160, join(out, "phone-screenshots", file));
    made.add(file);
  }
  // A screenshot no longer in the list goes, or Play would be sent it too.
  for (const file of await readdir(join(out, "phone-screenshots"))) {
    if (file.endsWith(".png") && !made.has(file)) {
      await rm(join(out, "phone-screenshots", file));
      console.log(`play-graphics: removed ${file}`);
    }
  }
} finally {
  await browser.close();
}
console.log("play-graphics: done");
