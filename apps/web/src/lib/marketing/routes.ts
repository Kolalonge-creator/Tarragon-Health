/** Public marketing routes: keep in sync with nav, proxy public-path allowlist, and MARKETING_SITE_SPEC.md §2. */

export const MARKETING_ROUTES = {
  home: "/",
  services: "/services",
  chronicCare: "/chronic-care",
  careCoordination: "/care-coordination",
  whoItsFor: "/who-its-for",
  forYou: "/for-you",
  hypertension: "/hypertension",
  diabetes: "/diabetes",
  obesity: "/obesity",
  parentcare: "/parentcare",
  prevention: "/prevention",
  annualHealthCheck: "/annual-health-check",
  screeningJourney: "/screening-journey",
  vaccinations: "/vaccinations",
  mentalWellbeingCheck: "/mental-wellbeing-check",
  healthEducation: "/health-education",
  bmiCalculator: "/bmi-calculator",
  activityCalculator: "/activity-calculator",
  medication: "/medication",
  labs: "/labs",
  pricing: "/pricing",
  howPricingWorks: "/pricing/how-it-works",
  coverage: "/coverage",
  accountability: "/accountability",
  about: "/about",
  careers: "/careers",
  faq: "/faq",
  corporate: "/corporate",
  hmo: "/hmo",
  resources: "/resources",
  impact: "/impact",
  contact: "/contact",
  privacy: "/privacy",
  telehealthConsent: "/telehealth-consent",
  terms: "/terms",
  accessibility: "/accessibility",
  cookies: "/cookies",
  gift: "/gift",
} as const;

export type MarketingRouteKey = keyof typeof MARKETING_ROUTES;

/** Routes built in the current scaffold pass (update as pages ship). */
export const MARKETING_ROUTES_BUILT: MarketingRouteKey[] = [
  "home",
  "services",
  "chronicCare",
  "careCoordination",
  "whoItsFor",
  "forYou",
  "hypertension",
  "diabetes",
  "obesity",
  "parentcare",
  "prevention",
  "annualHealthCheck",
  "screeningJourney",
  "vaccinations",
  "mentalWellbeingCheck",
  "healthEducation",
  "bmiCalculator",
  "activityCalculator",
  "medication",
  "labs",
  "pricing",
  "howPricingWorks",
  "coverage",
  "accountability",
  "about",
  "careers",
  "faq",
  "corporate",
  "hmo",
  "resources",
  "impact",
  "contact",
  "privacy",
  "telehealthConsent",
  "terms",
  "accessibility",
  "cookies",
  "gift",
];

export const MARKETING_PATH_PREFIXES = Object.values(MARKETING_ROUTES).filter(
  (path) => path !== "/"
);

export function isMarketingPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return MARKETING_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
