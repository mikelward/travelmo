// Writes every source of Travelmo's icon from one description of the mark:
// a paper plane with a trail of curved dashes, and in the notification icon
// one curved dash. `node scripts/icon-sources.mjs`, then
// `pnpm --filter @travelmo/web icons` to render the PNGs. Dashes are separate
// curves rather than a stroke-dasharray, because Android's vector drawables
// cannot draw dashed strokes.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORANGE = "#F26B1D";
const r1 = n => Math.round(n * 10) / 10;
const r3 = n => Math.round(n * 1000) / 1000;

// The plane, placed by scale and offset in a 512 space.
function plane(scale, sw) {
  const tx = 430 - 416 * scale, ty = 126 - 128 * scale;
  const p = ([x, y]) => [r1(x * scale + tx), r1(y * scale + ty)];
  return { nose: p([416, 128]), wing: p([96, 288]), tail: p([320, 416]), fold: p([256, 304]), sw: r1(sw * scale) };
}

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const at = (c, t) => {
  const [p0, p1, p2, p3] = c, u = 1 - t;
  return [0, 1].map(i => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
};
// The part of cubic c between t0 and t1, as a cubic (de Casteljau).
function sub(c, t0, t1) {
  const split = (c, t) => {
    const [p0, p1, p2, p3] = c;
    const a = lerp(p0, p1, t), b = lerp(p1, p2, t), d = lerp(p2, p3, t), e = lerp(a, b, t), f = lerp(b, d, t), g = lerp(e, f, t);
    return [[p0, a, e, g], [g, f, d, p3]];
  };
  const right = split(c, t0)[1];
  return split(right, (t1 - t0) / (1 - t0))[0];
}
// Dashes of length `dash` with gaps `gap` along cubic c, from its start.
function dashes(c, dash, gap) {
  const n = 4000, ts = [0], lens = [0];
  let prev = at(c, 0);
  for (let i = 1; i <= n; i++) {
    const p = at(c, i / n);
    lens.push(lens[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    ts.push(i / n);
    prev = p;
  }
  const tAt = len => ts[lens.findIndex(l => l >= len)] ?? 1;
  const out = [];
  for (let s = 0; s < lens[n]; s += dash + gap) out.push(sub(c, tAt(s), tAt(Math.min(s + dash, lens[n]))));
  return out;
}
const curve = (x0, y0, x1, y1, x2, y2, x3, y3) => [[x0, y0], [x1, y1], [x2, y2], [x3, y3]];

// The art in the 512 space the variants page uses: plane at 0.76 with a
// 32 px line, the trail 26 px wide in dashes of 44 with gaps of 34; the
// notification's single dash 24 px wide.
const TRAIL = curve(120, 452, 168, 380, 214, 410, 262, 336);
const ONE_DASH = curve(168, 418, 190, 366, 232, 400, 262, 338);
const ART = {
  full: { plane: plane(0.76, 32), strokes: dashes(TRAIL, 44, 34), width: 26 },
  notification: { plane: plane(0.76, 32), strokes: [ONE_DASH], width: 24 },
};
ART.launcher = ART.full;

// The smallest circle around the box's center that holds the art, and the box.
function extent({ plane: pl, strokes, width }) {
  const pts = [pl.nose, pl.wing, pl.tail, pl.fold].map(([x, y]) => ({ x, y, r: pl.sw / 2 }));
  for (const c of strokes) for (let i = 0; i <= 50; i++) { const [x, y] = at(c, i / 50); pts.push({ x, y, r: width / 2 }); }
  const x0 = Math.min(...pts.map(p => p.x - p.r)), x1 = Math.max(...pts.map(p => p.x + p.r));
  const y0 = Math.min(...pts.map(p => p.y - p.r)), y1 = Math.max(...pts.map(p => p.y + p.r));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const radius = Math.max(...pts.map(p => Math.hypot(p.x - cx, p.y - cy) + p.r));
  return { cx, cy, radius, size: Math.max(x1 - x0, y1 - y0) };
}

// translate(tx ty) scale(s) that centers the art at c, fitting a circle of radius r or a square of side size.
function fitCircle(a, c, r) { const e = extent(a), s = r / e.radius; return { s: Math.round(s * 1e5) / 1e5, tx: r3(c - e.cx * s), ty: r3(c - e.cy * s) }; }
function fitSquare(a, c, size) { const e = extent(a), s = size / e.size; return { s: Math.round(s * 1e5) / 1e5, tx: r3(c - e.cx * s), ty: r3(c - e.cy * s) }; }

const pt = ([x, y]) => `${r1(x)} ${r1(y)}`;
const polygon = pl => `M${pt(pl.wing)} ${pt(pl.nose)} ${pt(pl.tail)} ${pt(pl.fold)}Z`;
const foldLine = pl => `M${pt(pl.fold)} ${pt(pl.nose)}`;
const curvePath = c => `M${pt(c[0])} C${pt(c[1])} ${pt(c[2])} ${pt(c[3])}`;

function svgArt(a, color, f) {
  const pl = a.plane;
  return `  <g transform="translate(${f.tx} ${f.ty}) scale(${f.s})" stroke="${color}" stroke-linecap="round">
    <path d="${polygon(pl)}" fill="none" stroke-width="${pl.sw}" stroke-linejoin="round"/>
    <path d="${foldLine(pl)}" stroke-width="${pl.sw}"/>
${a.strokes.map(c => `    <path d="${curvePath(c)}" fill="none" stroke-width="${a.width}"/>`).join("\n")}
  </g>`;
}

function svg(comment, bg, art, f, rx = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- ${comment} -->
  <rect width="512" height="512"${rx ? ` rx="${rx}"` : ""} fill="${bg}"/>
${svgArt(art, "#fff", f)}
</svg>
`;
}

const strokePath = (d, color, width, join = false) => `        <path
            android:pathData="${d}"
            android:strokeColor="${color}"
            android:strokeWidth="${width}"
            android:strokeLineCap="round"${join ? `
            android:strokeLineJoin="round"` : ""} />`;

function vector(comment, size, art, f, color) {
  const pl = art.plane;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${comment} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${size}"
    android:viewportHeight="${size}">
    <group
        android:scaleX="${f.s}"
        android:scaleY="${f.s}"
        android:translateX="${f.tx}"
        android:translateY="${f.ty}">
${[strokePath(polygon(pl), color, pl.sw, true), strokePath(foldLine(pl), color, pl.sw), ...art.strokes.map(c => strokePath(curvePath(c), color, art.width))].join("\n")}
    </group>
</vector>
`;
}

const web = join(repo, "apps/web");
const res = join(repo, "apps/android/app/src/main/res");
const play = join(repo, "apps/android/play");

writeFileSync(join(web, "src/app/icon.svg"),
  svg("The launcher mark: a paper plane with a trail of curved dashes, on orange.", ORANGE, ART.launcher, fitCircle(ART.launcher, 256, 196), 96));
writeFileSync(join(web, "icons/maskable.svg"),
  svg("Full bleed for launchers that cut their own shape; the mark sits in\n       the central 80% safe zone (a 409.6 px circle).", ORANGE, ART.launcher, fitCircle(ART.launcher, 256, 184)));
writeFileSync(join(web, "icons/apple.svg"),
  svg("iOS rounds the corners itself and shows transparency as black, so the\n       square is filled to the edge.", ORANGE, ART.launcher, fitCircle(ART.launcher, 256, 196)));
// Play: the adaptive icon's visible 72 dp scaled to 512, so the mark fills the same 66 dp safe zone.
writeFileSync(join(play, "icon.svg"),
  svg("The Play listing icon, 512 px full bleed: Play rounds the corners. The\n       mark fills the same safe zone as the launcher icon.", ORANGE, ART.full, fitCircle(ART.full, 256, 33 * 512 / 72)));
writeFileSync(join(res, "drawable/ic_launcher_foreground.xml"),
  vector("The launcher mark (apps/web/src/app/icon.svg): a paper plane with a trail of\n     curved dashes, filling the adaptive icon's 66dp safe zone. Also the themed icon.", 108, ART.launcher, fitCircle(ART.launcher, 54, 33), "#FFFFFF"));
writeFileSync(join(res, "drawable/ic_notification.xml"),
  vector("The status-bar icon: the launcher's paper plane with one curved dash of\n     trail, in the 20dp live area, white on transparent as the system requires.", 24, ART.notification, fitSquare(ART.notification, 12, 20), "#FFFFFFFF"));

// The in-app logo beside the wordmark: the web icon (app/icon.svg) as a vector,
// orange rounded square and all, so Compose draws it without a bitmap.
function logoVector(art, f) {
  const pl = art.plane;
  const square = "M96 0H416A96 96 0 0 1 512 96V416A96 96 0 0 1 416 512H96A96 96 0 0 1 0 416V96A96 96 0 0 1 96 0Z";
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/icon-sources.mjs; edit that instead. The logo beside the
     "Travelmo" wordmark: the web app's icon (apps/web/src/app/icon.svg). -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="96dp"
    android:height="96dp"
    android:viewportWidth="512"
    android:viewportHeight="512">
    <path
        android:pathData="${square}"
        android:fillColor="${ORANGE}" />
    <group
        android:scaleX="${f.s}"
        android:scaleY="${f.s}"
        android:translateX="${f.tx}"
        android:translateY="${f.ty}">
${[strokePath(polygon(pl), "#FFFFFF", pl.sw, true), strokePath(foldLine(pl), "#FFFFFF", pl.sw), ...art.strokes.map(c => strokePath(curvePath(c), "#FFFFFF", art.width))].join("\n")}
    </group>
</vector>
`;
}
writeFileSync(join(res, "drawable/logo.xml"), logoVector(ART.launcher, fitCircle(ART.launcher, 256, 196)));

// The web app's inline logo, the same mark as app/icon.svg.
function logo(art, f) {
  const pl = art.plane;
  const strokes = art.strokes.map(c => `        <path d="${curvePath(c)}" fill="none" strokeWidth="${art.width}" />`).join("\n");
  return `// Written by scripts/icon-sources.mjs; edit that instead. The app icon
// (app/icon.svg) inline, so it is crisp at any size and needs no request.
// Decorative beside the "Travelmo" wordmark, so screen readers skip it.
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="96" fill="${ORANGE}" />
      <g transform="translate(${f.tx} ${f.ty}) scale(${f.s})" stroke="#fff" strokeLinecap="round">
        <path d="${polygon(pl)}" fill="none" strokeWidth="${pl.sw}" strokeLinejoin="round" />
        <path d="${foldLine(pl)}" strokeWidth="${pl.sw}" />
${strokes}
      </g>
    </svg>
  );
}
`;
}
writeFileSync(join(web, "src/components/Logo.tsx"), logo(ART.launcher, fitCircle(ART.launcher, 256, 196)));
console.log("icon-sources: wrote the web icons, the Play icon, the Android vectors, the in-app logo and Logo.tsx");
