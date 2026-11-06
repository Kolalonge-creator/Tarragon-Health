import type { MetadataRoute } from "next";
import { SITE_URL, absoluteUrl } from "@/lib/marketing/site";

/**
 * Allow crawling of the public marketing site; keep authenticated platform
 * areas (served on the same deployment under app.*) out of the index. Paths
 * mirror the role-home prefixes in src/lib/auth/roles.ts plus the auth routes.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/patient",
        "/clinician",
        "/admin",
        "/pharmacist",
        "/lab-partner",
        "/lab-liaison",
        "/finance",
        "/analytics",
        "/dashboard",
        "/onboarding",
        // /login and /signup are crawlable on purpose: they carry noindex
        // (website Phase 5), and a disallow would hide that from crawlers.
        "/auth",
        "/api",
        // Signed-in or token-only areas the live audit found missing here.
        "/payer",
        "/provider-org",
        "/reader",
        "/share",
        "/claim",
        "/circle",
        "/account",
        "/credentialing",
        "/doctor",
        "/rota",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
