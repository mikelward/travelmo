// Shared projection, Douglas-Peucker simplification and SVG path encoding
// for countryLandmarks.mjs and stateLandmarks.mjs (48×48 viewBox, 1.5 stroke).

export function foldText(text) {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

export function albers(lon, lat, phi1Deg, phi2Deg, phi0Deg, lam0Deg, rotDeg = 0) {
  const rad = Math.PI / 180;
  const phi1 = phi1Deg * rad;
  const phi2 = phi2Deg * rad;
  const phi0 = phi0Deg * rad;
  const lam0 = lam0Deg * rad;
  const n = 0.5 * (Math.sin(phi1) + Math.sin(phi2));
  const C = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(phi0)) / n;
  const rho = Math.sqrt(Math.max(0, C - 2 * n * Math.sin(lat * rad))) / n;
  const theta = n * (lon * rad - lam0);
  const x = rho * Math.sin(theta);
  const y = rho * Math.cos(theta) - rho0;
  if (!rotDeg) return [x, y];
  const r = rotDeg * rad;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a) / 2;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function dpOpen(pts, eps) {
  if (pts.length <= 2) return pts;
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = dpOpen(pts.slice(0, idx + 1), eps);
    const right = dpOpen(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

export function dpRing(ring, eps) {
  const open = ring.slice(0, -1);
  if (open.length <= 3) return open;
  let far = 1;
  let maxD = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > maxD) {
      maxD = d;
      far = i;
    }
  }
  const a = dpOpen(open.slice(0, far + 1), eps);
  const b = dpOpen(open.slice(far).concat([open[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

export function spanOf(pts) {
  let rxMin = Infinity;
  let rxMax = -Infinity;
  let ryMin = Infinity;
  let ryMax = -Infinity;
  for (const [x, y] of pts) {
    if (x < rxMin) rxMin = x;
    if (x > rxMax) rxMax = x;
    if (y < ryMin) ryMin = y;
    if (y > ryMax) ryMax = y;
  }
  return Math.max(rxMax - rxMin, ryMax - ryMin);
}

export function fitTransform(rings, pad) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const scale = (48 - 2 * pad) / Math.max(w, h);
  const ox = (48 - w * scale) / 2 - minX * scale;
  const oy = (48 - h * scale) / 2 - minY * scale;
  return (r) => r.map(([x, y]) => [x * scale + ox, y * scale + oy]);
}

const fmt = (n) => Math.round(n * 10) / 10;

export function encodeClosedRing(scaled, { eps, smooth, minEps = 0.4, spanFactor = 0.16 }) {
  const span = spanOf(scaled);
  // Secondary islands (Tasmania, Northern Ireland, Corsica, smaller Hawaiian
  // islands) need a smaller tolerance so Douglas-Peucker does not collapse them.
  const ringEps = Math.min(eps, Math.max(minEps, span * spanFactor));
  const simp = dpRing(scaled, ringEps);
  if (simp.length < 3) return "";
  if (smooth) {
    const n = simp.length;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const start = mid(simp[n - 1], simp[0]);
    let d = `M${fmt(start[0])} ${fmt(start[1])}`;
    for (let i = 0; i < n; i++) {
      const m = mid(simp[i], simp[(i + 1) % n]);
      d += `Q${fmt(simp[i][0])} ${fmt(simp[i][1])} ${fmt(m[0])} ${fmt(m[1])}`;
    }
    return `${d}Z`;
  }
  return `M${simp.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}Z`;
}

export function encodeOpenArc(scaled, { eps, smooth }) {
  const span = spanOf(scaled);
  const arcEps = Math.min(eps, Math.max(0.35, span * 0.14));
  const simp = dpOpen(scaled, arcEps);
  if (simp.length < 2) return "";
  if (smooth && simp.length >= 3) {
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let d = `M${fmt(simp[0][0])} ${fmt(simp[0][1])}`;
    for (let i = 1; i < simp.length - 1; i++) {
      const m = mid(simp[i], simp[i + 1]);
      d += `Q${fmt(simp[i][0])} ${fmt(simp[i][1])} ${fmt(m[0])} ${fmt(m[1])}`;
    }
    const last = simp[simp.length - 1];
    d += `L${fmt(last[0])} ${fmt(last[1])}`;
    return d;
  }
  return `M${simp.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}`;
}
