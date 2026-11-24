import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // When this bundle was built, which a bug report names as the version.
  env: { NEXT_PUBLIC_BUILT_AT: new Date().toISOString().slice(0, 16) + "Z" },
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Holds navigations and prefetches while offline and retries them when
    // the connection returns; exposes useOffline for the banner.
    useOffline: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // The browser must always see the newest worker.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
