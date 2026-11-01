import { build } from "esbuild";

// Bundles the service worker into public/sw.js, where Next serves it at /sw.js.
// Turbopack does not bundle workers from `public`, so this runs before
// `next build` (see the build script). Every build gets a new id, so a deploy
// installs a new worker and refreshes the pages it precaches.
await build({
  entryPoints: ["src/sw.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "public/sw.js",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    BUILD_ID: JSON.stringify(Date.now().toString(36)),
  },
  logLevel: "info",
});
