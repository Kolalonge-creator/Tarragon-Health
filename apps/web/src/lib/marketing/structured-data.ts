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
 * "₦50,000" -> 50000. Returns null for anything that isn't a plain naira
 * amount, so a copy string like "From ₦2,500 per visit" never becomes a
 * confident, wrong `price` in structured data.
 */
export function parseNairaAmount(raw: string): number | null {
  const match = /^₦([\d,]+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const major = Number(match[1]!.replace(/,/g, ""));
  if (!Number.isFinite(major)) return null;
  const minor = match[2] ? Number(`0.${match[2]}`) : 0;
  return major + minor;
}

export type OfferInput = {
  id: string;
  name: string;
  description: string;
  /** Formatted naira string, live price where one was resolved. */
  price: string;
};

/**
 * The paid menu as a schema.org Service with an OfferCatalog.
 *
 * A Service (not a Product): what is sold is a doctor's time, priced per piece
 * of work. Every price is NGN because that is the only currency this platform
 * charges in (Paystack; the USD/diaspora tier was retired 2026-07-31, and
 * Stripe was removed entirely 2026-09-02). Any entry whose price string is not
 * a plain naira amount is skipped rather than guessed at.
 */
export function paidServicesJsonLd({
  services,
  pageUrl,
  providerName,
  providerUrl,
}: {
  services: OfferInput[];
  pageUrl: string;
  providerName: string;
  providerUrl: string;
}): JsonLd {
  const offers = services
    .map((service) => {
      const amount = parseNairaAmount(service.price);
      if (amount === null) return null;
      return {
        "@type": "Offer",
        name: service.name,
        description: service.description,
        price: amount.toString(),
        priceCurrency: "NGN",
        availability: "https://schema.org/InStock",
        url: pageUrl,
      };
    })
    .filter((offer): offer is NonNullable<typeof offer> => offer !== null);

  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Doctor's time, priced per piece of work",
    serviceType: "Remote clinical review and chronic disease management",
    url: pageUrl,
    areaServed: { "@type": "Country", name: "Nigeria" },
    provider: {
      "@type": "MedicalOrganization",
      name: providerName,
      url: providerUrl,
    },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "TarragonHealth paid services",
      itemListElement: offers,
    },
  };
}
