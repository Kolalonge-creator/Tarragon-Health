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
        "/doctor",
        "/admin",
        "/pharmacist",
        "/analytics",
        "/dashboard",
        "/onboarding",
        "/login",
        "/signup",
        "/auth",
        "/api",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
