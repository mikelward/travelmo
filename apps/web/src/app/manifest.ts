import type { MetadataRoute } from "next";

// What installing Travelmo uses. Android wants PNGs at 192 and 512 (a
// maskable one for launchers that cut their own shape); `scripts/icons.mjs`
// renders them from the SVGs. iOS reads `app/apple-icon.png` instead.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Travelmo",
    short_name: "Travelmo",
    description: "Your trips in one place, imported from your inbox.",
    lang: "en-US",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    categories: ["travel"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
