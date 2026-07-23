import type { MetadataRoute } from "next";
import { MARKETING_ROUTES, MARKETING_ROUTES_BUILT } from "@/lib/marketing/routes";
import { absoluteUrl } from "@/lib/marketing/site";
import { loadResourceArticles } from "@/lib/marketing/resources-data";

/**
 * Marketing sitemap: only the public pages that are actually built. Platform
 * (app.*) routes are intentionally excluded — they live behind auth and are
 * disallowed in robots.ts.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
  // Admin-published (DB) articles included; falls back to the static seed set.
  // Uses each row's real updated_at where available — claiming "changed
  // today" on every crawl (the old `new Date()` default) trains crawlers to
  // distrust the signal.
  const resourceArticles = await loadResourceArticles();
  const articles: MetadataRoute.Sitemap = resourceArticles.map((article) => ({
    url: absoluteUrl(`/resources/${article.slug}`),
    lastModified: article.updatedAt ? new Date(article.updatedAt) : lastModified,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...pages, ...articles];
}
