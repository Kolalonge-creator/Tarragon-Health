import type { MetadataRoute } from "next";

/**
 * Installable web app (PWA) manifest — lets patients and staff add the
 * platform to their iPhone/Android home screen straight from the browser.
 *
 * start_url is /login rather than /: the marketing homepage owns "/" on the
 * root domain, and proxy.ts already bounces an authenticated visitor from
 * /login to their role home — so the installed app always opens on the
 * platform, never the marketing site.
 *
 * No service worker on purpose: install prompts no longer require one, and
 * cached-stale clinical data (vitals, escalations, results) is a safety
 * hazard on a health platform. The installed app is always the live site.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TarragonHealth",
    short_name: "Tarragon",
    description:
      "Nigeria's digital-first chronic disease, preventive health, and family care coordination platform. Care that stays with you.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFFFFF",
    theme_color: "#0E7C52",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
