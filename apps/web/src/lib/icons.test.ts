import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Next.js serves app/icon.svg, app/apple-icon.png and the like at the site
// root, and a same-named file in public/ wins, so a stale copy there shows
// browsers the old icon.
const app = new URL("../app/", import.meta.url);
const pub = new URL("../../public/", import.meta.url);
const metadataFile = /^(icon|apple-icon|favicon)(\d*)\.\w+$/;

describe("app icons", () => {
  it("are not shadowed by files in public/", () => {
    const icons = readdirSync(app).filter((name) => metadataFile.test(name));
    expect(icons).toContain("icon.svg");
    for (const name of icons) {
      expect(existsSync(new URL(name, pub)), `public/${name}`).toBe(false);
    }
  });
});
