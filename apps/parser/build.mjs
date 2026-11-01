import { build } from "esbuild";
import { readFile } from "node:fs/promises";

// Bundle workspace source (so Node never sees packages/core's .ts files)
// but leave npm dependencies external; the image installs those with pnpm.
const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.entries(pkg.dependencies)
  .filter(([, version]) => !String(version).startsWith("workspace:"))
  .map(([name]) => name);

await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/server.mjs",
  external,
  sourcemap: true,
  logLevel: "info",
});
