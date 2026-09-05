"use client";

import { usePathname } from "next/navigation";
import { breadcrumbJsonLd } from "@/lib/marketing/structured-data";

/**
 * BreadcrumbList structured data for every marketing page, emitted once from
 * the marketing layout.
 *
 * A client component only because it needs the current path; `usePathname` is
 * available during static rendering (unlike `useSearchParams`, it does not
 * suspend), so the JSON-LD is present in the prerendered HTML a crawler sees.
 * Rendering it here rather than page-by-page is what keeps a new page from
 * silently shipping without breadcrumbs.
 *
 * There is deliberately no visible breadcrumb UI to match. Google's guidance
 * is that BreadcrumbList should reflect the page's position in the site
 * hierarchy, which the URL already states honestly here; adding a second
 * navigation affordance to every page is a design decision, not an SEO fix.
 */
export function BreadcrumbJsonLd() {
  const pathname = usePathname();
  const jsonLd = breadcrumbJsonLd(pathname ?? "/");
  if (!jsonLd) return null;

  return (
    <script
      type="application/ld+json"
      // First-party, derived entirely from the route table; no user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
