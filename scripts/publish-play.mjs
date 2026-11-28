#!/usr/bin/env node
// Checks the Play store listing kept in apps/android/play (each language's
// texts, feature graphic and phone screenshots, plus the shared 512 px icon),
// or publishes it together with the newest release bundle. No dependencies:
// Node's own fetch and crypto talk to the Play Developer API with the service
// account's key.
//
//   node scripts/publish-play.mjs --check   # validate only (CI on every PR)
//   PLAY_SERVICE_ACCOUNT_JSON=… [PLAY_RELEASES=releases.json PLAY_BUNDLE=x.aab] node scripts/publish-play.mjs
//
// Publishing opens one edit. With PLAY_BUNDLE, the newest GitHub release's
// bundle, it puts that bundle on the internal track unless Play already has
// it or a newer one, with "What's new" gathered from every release in
// PLAY_RELEASES (GitHub's release list) since the one Play has. Then it
// compares each language's texts and images with Play's, replaces only what
// differs, and commits once; with nothing new it commits nothing. Play
// limits how many edits an app may commit a day, so the play workflow triggers
// after main CI succeeds and coalesces rapid pushes with a 45-minute cooldown.
// On any failure the edit is deleted, so Play never sees half a release.
import { createHash, createSign } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE = "app.travelmo";
export const PLAY_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "android", "play");
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3";

export const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };

// Width and height from a PNG's header, or an error naming the file.
export function pngSize(bytes, name) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) throw new Error(`${name} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// Everything wrong with a listing, as sentences; empty when Play will take it.
export function problems(listing) {
  const out = [];
  const where = listing.language;
  for (const [key, max] of Object.entries(LIMITS)) {
    const text = listing[key];
    if (!text) out.push(`${where}: ${key} is missing`);
    else if ([...text].length > max) out.push(`${where}: ${key} is ${[...text].length} characters; Play allows ${max}`);
  }
  const { icon, featureGraphic, phoneScreenshots } = listing;
  if (!icon) out.push(`${where}: no icon`);
  else if (icon.width !== 512 || icon.height !== 512) out.push(`${where}: the icon is ${icon.width}×${icon.height}; Play wants 512×512`);
  if (!featureGraphic) out.push(`${where}: no feature graphic`);
  else if (featureGraphic.width !== 1024 || featureGraphic.height !== 500) {
    out.push(`${where}: the feature graphic is ${featureGraphic.width}×${featureGraphic.height}; Play wants 1024×500`);
  }
  if (phoneScreenshots.length < 2 || phoneScreenshots.length > 8) {
    out.push(`${where}: ${phoneScreenshots.length} phone screenshots; Play wants 2 to 8`);
  }
  for (const s of phoneScreenshots) {
    const long = Math.max(s.width, s.height), short = Math.min(s.width, s.height);
    if (short < 320 || long > 3840) out.push(`${where}: ${s.name} is ${s.width}×${s.height}; each side must be 320 to 3840 px`);
    else if (long > 2 * short) out.push(`${where}: ${s.name} is ${s.width}×${s.height}; its long side may be at most twice its short side`);
  }
  return out;
}

const text = (dir, file) => {
  const path = join(dir, file);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
};
const image = (path, name) => {
  const bytes = readFileSync(path);
  return { name, path, bytes, ...pngSize(bytes, name) };
};

// Reads every language under apps/android/play/listings.
export function readListings(playDir = PLAY_DIR) {
  const root = join(playDir, "listings");
  const iconPath = join(playDir, "icon-512.png");
  const icon = existsSync(iconPath) ? image(iconPath, "icon-512.png") : undefined;
  return readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(({ name: language }) => {
      const dir = join(root, language);
      const featurePath = join(dir, "feature-graphic.png");
      const shotsDir = join(dir, "phone-screenshots");
      const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter(f => f.endsWith(".png")).sort() : [];
      return {
        language,
        title: text(dir, "title.txt"),
        shortDescription: text(dir, "short-description.txt"),
        fullDescription: text(dir, "full-description.txt"),
        icon,
        featureGraphic: existsSync(featurePath) ? image(featurePath, `${language}/feature-graphic.png`) : undefined,
        phoneScreenshots: shots.map(f => image(join(shotsDir, f), `${language}/phone-screenshots/${f}`)),
      };
    });
}

export const IMAGE_TYPES = ["icon", "featureGraphic", "phoneScreenshots"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// What differs between a listing in the repo and Play's copy of it: whether
// the texts do, and which image types (each compared as an ordered list of
// SHA-256 hashes). `remote` is { texts, images: { type: [sha256…] } }, with
// texts undefined when Play has no listing in that language yet.
export function differences(listing, remote) {
  const t = remote.texts;
  const texts = !t || t.title !== listing.title || t.shortDescription !== listing.shortDescription || t.fullDescription !== listing.fullDescription;
  const local = { icon: [listing.icon], featureGraphic: [listing.featureGraphic], phoneScreenshots: listing.phoneScreenshots };
  const images = IMAGE_TYPES.filter(type => {
    const mine = local[type].map(f => sha256(f.bytes));
    const theirs = remote.images[type] ?? [];
    return mine.length !== theirs.length || mine.some((h, i) => h !== theirs[i]);
  });
  return { texts, images };
}

// Play's "What's new" takes 500 characters per language.
export const NOTES_LIMIT = 500;

// The release to put on Play's internal track, or undefined when Play already
// has `bundleCode` or newer. `releases` is GitHub's list ({ tag_name, body }),
// `playCodes` the versionCodes on the internal track. "What's new" is each
// "• " line of every release after Play's newest up to the bundle's, oldest
// first and each once, cut to Play's limit.
export function playRelease(releases, playCodes, bundleCode) {
  const onPlay = Math.max(0, ...playCodes.map(Number));
  if (bundleCode <= onPlay) return undefined;
  const lines = releases
    .map(r => ({ code: /^v(\d+)$/.exec(r.tag_name ?? "")?.[1], body: r.body ?? "" }))
    .filter(r => r.code && Number(r.code) > onPlay && Number(r.code) <= bundleCode)
    .sort((a, b) => Number(a.code) - Number(b.code))
    .flatMap(r => r.body.split("\n").map(l => l.trim()).filter(l => l.startsWith("• ")));
  let notes = [...new Set(lines)].join("\n");
  if ([...notes].length > NOTES_LIMIT) notes = [...notes].slice(0, NOTES_LIMIT - 1).join("") + "…";
  return { versionCode: bundleCode, notes };
}

async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");
  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Google refused the service account's key: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function publish(listings, key, bundle) {
  const token = await accessToken(key);
  const call = async (method, url, body, contentType = "application/json", allowMissing = false) => {
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": contentType } : {}) },
      body: body && contentType === "application/json" ? JSON.stringify(body) : body,
    });
    if (allowMissing && res.status === 404) return undefined;
    if (!res.ok) throw new Error(`${method} ${url.replace(/\?.*/, "")}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? undefined : res.json();
  };
  const app = `${API}/applications/${PACKAGE}`;
  const { id } = await call("POST", `${app}/edits`, {});
  console.log(`Opened edit ${id}`);
  try {
    let changed = false;
    if (bundle) {
      const track = await call("GET", `${app}/edits/${id}/tracks/internal`, undefined, undefined, true);
      const playCodes = (track?.releases ?? []).flatMap(r => r.versionCodes ?? []);
      const release = playRelease(bundle.releases, playCodes, bundle.versionCode);
      if (!release) {
        console.log(`Internal track: already has versionCode ${Math.max(...playCodes.map(Number))}`);
      } else {
        const uploaded = await call("POST", `${UPLOAD}/applications/${PACKAGE}/edits/${id}/bundles?uploadType=media`, bundle.bytes, "application/octet-stream");
        if (Number(uploaded.versionCode) !== release.versionCode) {
          throw new Error(`the bundle is versionCode ${uploaded.versionCode}, not ${release.versionCode} as its release is tagged`);
        }
        await call("PUT", `${app}/edits/${id}/tracks/internal`, {
          track: "internal",
          releases: [{
            versionCodes: [String(release.versionCode)],
            status: "completed",
            ...(release.notes ? { releaseNotes: [{ language: "en-US", text: release.notes }] } : {}),
          }],
        });
        console.log(`Internal track: versionCode ${release.versionCode}`);
        changed = true;
      }
    }
    for (const l of listings) {
      const base = `${app}/edits/${id}/listings/${l.language}`;
      const texts = await call("GET", base, undefined, undefined, true);
      const images = {};
      for (const type of IMAGE_TYPES) {
        const found = await call("GET", `${base}/${type}`, undefined, undefined, true);
        images[type] = (found?.images ?? []).map(i => i.sha256);
      }
      const diff = differences(l, { texts, images });
      if (diff.texts) {
        await call("PUT", base, { language: l.language, title: l.title, shortDescription: l.shortDescription, fullDescription: l.fullDescription });
      }
      const files = { icon: [l.icon], featureGraphic: [l.featureGraphic], phoneScreenshots: l.phoneScreenshots };
      for (const type of diff.images) {
        await call("DELETE", `${base}/${type}`);
        for (const f of files[type]) {
          await call("POST", `${UPLOAD}/applications/${PACKAGE}/edits/${id}/listings/${l.language}/${type}?uploadType=media`, f.bytes, "image/png");
        }
      }
      const what = [...(diff.texts ? ["texts"] : []), ...diff.images];
      console.log(`${l.language}: ${what.length ? `updated ${what.join(", ")}` : "already matches Play"}`);
      changed ||= what.length > 0;
    }
    if (!changed) {
      await call("DELETE", `${app}/edits/${id}`);
      console.log("Play already has this release and listing; nothing committed");
      return;
    }
    await call("POST", `${app}/edits/${id}:commit`);
    console.log("Committed");
  } catch (err) {
    console.error(`Publishing failed; deleting edit ${id} so nothing half-done reaches Play`);
    await call("DELETE", `${app}/edits/${id}`).catch(cleanup => console.error(`Could not delete edit ${id}: ${cleanup.message}`));
    throw err;
  }
}

async function main() {
  const check = process.argv.includes("--check");
  console.log(`Play: ${check ? "checking" : "publishing"} ${PLAY_DIR}`);
  const listings = readListings();
  const found = listings.flatMap(problems);
  if (listings.length === 0) found.push("no languages under apps/android/play/listings");
  if (found.length) {
    for (const p of found) console.error(`::error::${p}`);
    throw new Error(`${found.length} problem(s) with the Play listing`);
  }
  console.log(`${listings.map(l => l.language).join(", ")}: ready for Play`);
  if (check) return;
  const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("PLAY_SERVICE_ACCOUNT_JSON is not set");
  const { PLAY_BUNDLE, PLAY_RELEASES } = process.env;
  let bundle;
  if (PLAY_BUNDLE) {
    if (!PLAY_RELEASES) throw new Error("PLAY_BUNDLE is set without PLAY_RELEASES");
    const versionCode = Number(/-(\d+)\.aab$/.exec(PLAY_BUNDLE)?.[1]);
    if (!versionCode) throw new Error(`${PLAY_BUNDLE} does not end in -<versionCode>.aab`);
    bundle = { versionCode, bytes: readFileSync(PLAY_BUNDLE), releases: JSON.parse(readFileSync(PLAY_RELEASES, "utf8")) };
    console.log(`Newest release: versionCode ${versionCode}`);
  }
  await publish(listings, JSON.parse(raw), bundle);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    () => console.log("Play: done"),
    err => {
      console.error(`Play: failed: ${err.message}`);
      process.exitCode = 1;
    },
  );
}
