import { MARKETING_ROUTES, type MarketingRouteKey } from "./routes";
import { absoluteUrl } from "./site";

/**
 * schema.org helpers for the marketing site.
 *
 * Kept as pure functions taking plain data so they can be unit-tested without
 * a renderer: every one of these ends up inside a
 * `<script type="application/ld+json">`, where a silently wrong shape costs a
 * rich result and nobody notices for months.
 */

export type JsonLd = Record<string, unknown>;

/**
 * Human labels for breadcrumb trails, keyed by marketing route.
 *
 * Deliberately short nouns, not the page <title>: a breadcrumb crumb is a
 * position in the site, not a headline. Any path with no entry here falls back
 * to a humanised final segment (see `humaniseSegment`), which is what
 * /resources/<slug> relies on, since those slugs are generated from the
 * article titles.
 */
export const BREADCRUMB_LABELS: Partial<Record<MarketingRouteKey, string>> = {
  home: "Home",
  services: "Services",
  chronicCare: "Chronic care",
  careCoordination: "Care coordination",
  whoItsFor: "Who it's for",
  forYou: "For individuals",
  hypertension: "Hypertension",
  diabetes: "Diabetes",
  obesity: "Weight health",
  parentcare: "Caring for a parent",
  prevention: "Prevention",
  annualHealthCheck: "Annual Health Check",
  advancedDiagnostics: "Advanced Diagnostics",
  screeningJourney: "Screening Journey",
  vaccinations: "Vaccinations",
  mentalWellbeingCheck: "Mental Well-being Check",
  healthEducation: "Health Education",
  bmiCalculator: "BMI & Calorie Calculator",
  activityCalculator: "Activity Calculator",
  medication: "Medication",
  labs: "Labs",
  devices: "Devices",
  pricing: "Pricing",
  howPricingWorks: "How pricing works",
  coverage: "Where we work",
  accountability: "Accountability",
  about: "About",
  careers: "Careers",
  faq: "FAQ",
  corporate: "For employers",
  hmo: "For HMOs",
  resources: "Health resources",
  impact: "Our impact",
  contact: "Contact",
  privacy: "Privacy",
  telehealthConsent: "Telehealth consent",
  terms: "Terms of service",
  accessibility: "Accessibility",
  cookies: "Cookies",
  gift: "Gift Tarragon",
};

/** Path -> label, built once from the route table so the two cannot drift. */
const LABEL_BY_PATH = new Map<string, string>(
  (Object.keys(BREADCRUMB_LABELS) as MarketingRouteKey[]).map((key) => [
    MARKETING_ROUTES[key],
    BREADCRUMB_LABELS[key]!,
  ])
);

/** "understanding-blood-pressure" -> "Understanding blood pressure". */
export function humaniseSegment(segment: string): string {
  const words = decodeURIComponent(segment).replace(/[-_]+/g, " ").trim();
  if (words.length === 0) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type BreadcrumbCrumb = { name: string; path: string };

/**
 * The crumb trail for a marketing path, always starting at Home.
 *
 * "/" itself gets no trail: a single-item BreadcrumbList is noise, and Google
 * ignores it. Every other path contributes one crumb per segment, so
 * /pricing/how-it-works yields Home > Pricing > How pricing works.
 */
export function breadcrumbTrail(pathname: string): BreadcrumbCrumb[] {
  const clean = pathname.split("?")[0]!.split("#")[0]!.replace(/\/+$/, "");
  if (clean === "" || clean === "/") return [];

  const segments = clean.split("/").filter(Boolean);
  const crumbs: BreadcrumbCrumb[] = [{ name: "Home", path: "/" }];

  let accumulated = "";
  for (const segment of segments) {
    accumulated += `/${segment}`;
    const name = LABEL_BY_PATH.get(accumulated) ?? humaniseSegment(segment);
    if (name) crumbs.push({ name, path: accumulated });
  }

  return crumbs.length > 1 ? crumbs : [];
}

/** BreadcrumbList JSON-LD, or null when the path has no meaningful trail. */
export function breadcrumbJsonLd(pathname: string): JsonLd | null {
  const crumbs = breadcrumbTrail(pathname);
  if (crumbs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/**
 * A programme or condition page as a schema.org MedicalWebPage with a
 * minimal, claim-free shape: name, description, the page URL and the
 * organisation behind it. Deliberately no `medicalAudience`, outcome or
 * efficacy fields: structured data is read by search engines as fact, and this
 * platform makes no outcome claim it could not defend (docs/BRAND_GUIDE.md).
 * Returns null when there is no usable title or description, so a page never
 * ships an empty or placeholder block.
 */
export function medicalWebPageJsonLd({
  name,
  description,
  path,
  providerName,
  providerUrl,
}: {
  name: string | null | undefined;
  description: string | null | undefined;
  path: string;
  providerName: string;
  providerUrl: string;
}): JsonLd | null {
  const cleanName = name?.trim();
  const cleanDescription = description?.trim();
  if (!cleanName || !cleanDescription) return null;
  return {
    "@context": "https://schema.org",
    "@type": "MedicalWebPage",
    name: cleanName,
    description: cleanDescription,
    url: absoluteUrl(path),
    inLanguage: "en-NG",
    publisher: {
      "@type": "MedicalOrganization",
      name: providerName,
      url: providerUrl,
    },
  };
}
