import type { MetadataRoute } from "next";
import { MARKETING_ROUTES, MARKETING_ROUTES_BUILT } from "@/lib/marketing/routes";
import { absoluteUrl } from "@/lib/marketing/site";
import { RESOURCE_ARTICLES } from "./(marketing)/_content/resources";

/**
 * Marketing sitemap: only the public pages that are actually built. Platform
 * (app.*) routes are intentionally excluded — they live behind auth and are
 * disallowed in robots.ts.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  // Priority/frequency tuned to how the site is navigated: home + core
  // decision pages rank highest, deeper programme pages a step below.
  const priorityByKey: Partial<Record<(typeof MARKETING_ROUTES_BUILT)[number], number>> = {
    home: 1,
    services: 0.9,
    pricing: 0.9,
    chronicCare: 0.8,
    prevention: 0.8,
    careCoordination: 0.8,
    whoItsFor: 0.7,
    about: 0.7,
  };

  const pages: MetadataRoute.Sitemap = MARKETING_ROUTES_BUILT.map((key) => ({
    url: absoluteUrl(MARKETING_ROUTES[key]),
    lastModified,
    changeFrequency: key === "home" ? "weekly" : "monthly",
    priority: priorityByKey[key] ?? 0.6,
  }));

  // Individual resource articles — the SEO surface the hub exists for.
  const articles: MetadataRoute.Sitemap = RESOURCE_ARTICLES.map((article) => ({
    url: absoluteUrl(`/resources/${article.slug}`),
    lastModified,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...pages, ...articles];
}
