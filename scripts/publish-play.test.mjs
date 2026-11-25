// node --test scripts/publish-play.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NOTES_LIMIT, differences, playRelease, pngSize, problems, readListings } from "./publish-play.mjs";

// A PNG header is all pngSize reads: signature, then IHDR's width and height.
function png(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const good = () => ({
  language: "en-US",
  title: "Travelmo",
  shortDescription: "Your trips in one place, imported from your inbox.",
  fullDescription: "Long enough.",
  icon: { width: 512, height: 512 },
  featureGraphic: { width: 1024, height: 500 },
  phoneScreenshots: [
    { name: "a.png", width: 1080, height: 1920 },
    { name: "b.png", width: 1080, height: 2160 },
  ],
});

test("reads a PNG's size and refuses anything else", () => {
  assert.deepEqual(pngSize(png(1024, 500), "x.png"), { width: 1024, height: 500 });
  assert.throws(() => pngSize(Buffer.from("not a png at all, really not"), "x.png"), /x.png is not a PNG/);
});

test("a listing within Play's rules has no problems", () => {
  assert.deepEqual(problems(good()), []);
});

test("names texts over Play's limits, counting characters rather than bytes", () => {
  const l = good();
  l.title = "é".repeat(30);
  assert.deepEqual(problems(l), []);
  l.title = "x".repeat(31);
  l.shortDescription = "";
  assert.deepEqual(problems(l), ["en-US: title is 31 characters; Play allows 30", "en-US: shortDescription is missing"]);
});

test("names graphics of the wrong size", () => {
  const l = good();
  l.icon = { width: 256, height: 256 };
  l.featureGraphic = undefined;
  assert.deepEqual(problems(l), ["en-US: the icon is 256×256; Play wants 512×512", "en-US: no feature graphic"]);
});

test("refuses screenshots taller than twice their width, too small, or too few", () => {
  const l = good();
  l.phoneScreenshots = [{ name: "tall.png", width: 1078, height: 2399 }];
  assert.deepEqual(problems(l), [
    "en-US: 1 phone screenshots; Play wants 2 to 8",
    "en-US: tall.png is 1078×2399; its long side may be at most twice its short side",
  ]);
  l.phoneScreenshots = [
    { name: "tiny.png", width: 300, height: 600 },
    { name: "ok.png", width: 1080, height: 1920 },
  ];
  assert.deepEqual(problems(l), ["en-US: tiny.png is 300×600; each side must be 320 to 3840 px"]);
});

test("reads each language's texts and images from the play directory", () => {
  const play = mkdtempSync(join(tmpdir(), "play-"));
  writeFileSync(join(play, "icon-512.png"), png(512, 512));
  const en = join(play, "listings", "en-US");
  mkdirSync(join(en, "phone-screenshots"), { recursive: true });
  writeFileSync(join(en, "title.txt"), "Travelmo\n");
  writeFileSync(join(en, "short-description.txt"), "Short.\n");
  writeFileSync(join(en, "full-description.txt"), "Full.\n");
  writeFileSync(join(en, "feature-graphic.png"), png(1024, 500));
  writeFileSync(join(en, "phone-screenshots", "02-b.png"), png(1080, 1920));
  writeFileSync(join(en, "phone-screenshots", "01-a.png"), png(1080, 1920));
  writeFileSync(join(en, "phone-screenshots", "notes.txt"), "ignored");

  const [l] = readListings(play);
  assert.equal(l.language, "en-US");
  assert.equal(l.title, "Travelmo");
  assert.equal(l.icon.width, 512);
  assert.equal(l.featureGraphic.height, 500);
  assert.deepEqual(l.phoneScreenshots.map(s => s.name), ["en-US/phone-screenshots/01-a.png", "en-US/phone-screenshots/02-b.png"]);
  assert.deepEqual(problems(l), []);
});

test("finds which parts of a listing differ from Play's copy", () => {
  const hash = b => createHash("sha256").update(b).digest("hex");
  const file = text => ({ bytes: Buffer.from(text) });
  const listing = { ...good(), icon: file("icon"), featureGraphic: file("feature"), phoneScreenshots: [file("a"), file("b")] };
  const texts = { title: listing.title, shortDescription: listing.shortDescription, fullDescription: listing.fullDescription };
  const same = { icon: [hash("icon")], featureGraphic: [hash("feature")], phoneScreenshots: [hash("a"), hash("b")] };

  assert.deepEqual(differences(listing, { texts, images: same }), { texts: false, images: [] });
  assert.deepEqual(differences(listing, { texts: { ...texts, title: "Old" }, images: same }), { texts: true, images: [] });
  assert.deepEqual(differences(listing, { texts, images: { ...same, phoneScreenshots: [hash("b"), hash("a")] } }), {
    texts: false,
    images: ["phoneScreenshots"],
  });
  assert.deepEqual(differences(listing, { texts: undefined, images: {} }), {
    texts: true,
    images: ["icon", "featureGraphic", "phoneScreenshots"],
  });
});

const release = (code, ...lines) => ({ tag_name: `v${code}`, body: `${lines.join("\n")}\n\nversionCode ${code}, built from abc.\n` });

test("puts the newest release on Play with every release's notes since Play's", () => {
  const releases = [release(370, "• Fix Nice"), release(369, "• Add 48 cities"), release(368, "• Add 45 cities"), release(367, "• Older")];
  assert.deepEqual(playRelease(releases, ["367"], 370), { versionCode: 370, notes: "• Add 45 cities\n• Add 48 cities\n• Fix Nice" });
});

test("leaves Play alone when it has the bundle or a newer one", () => {
  assert.equal(playRelease([release(370, "• A")], ["370"], 370), undefined);
  assert.equal(playRelease([release(370, "• A")], ["368", "371"], 370), undefined);
});

test("gathers notes from the first release when Play has none, each line once", () => {
  const releases = [release(2, "• Same", "• New"), release(1, "• Same"), { tag_name: "nightly", body: "• Not a release" }];
  assert.deepEqual(playRelease(releases, [], 2), { versionCode: 2, notes: "• Same\n• New" });
});

test("ignores releases newer than the bundle and cuts the notes to Play's limit", () => {
  const long = "• " + "x".repeat(600);
  assert.deepEqual(playRelease([release(3, "• Later"), release(2, long)], ["1"], 2).notes.length, NOTES_LIMIT);
  assert.equal(playRelease([release(3, "• Later"), release(2, "• Mine")], ["1"], 2).notes, "• Mine");
});
