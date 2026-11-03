import type { MetadataRoute } from "next";

/** Makes the site installable ("Add to Home screen") so it opens full-screen like an app, with no store needed. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NationX · Local shops in Khammam",
    short_name: "NationX",
    description: "Find local shops and services near you. Call, visit or get directions.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8f6ef",
    theme_color: "#0F766E",
    categories: ["shopping", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Explore stores", url: "/explore" },
      { name: "Help me find it", url: "/help-me-find-it" },
    ],
  };
}