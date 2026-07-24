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
  vaccinations: "/vaccinations",
  healthEducation: "/health-education",
  medication: "/medication",
  labs: "/labs",
  pricing: "/pricing",
  about: "/about",
  faq: "/faq",
  corporate: "/corporate",
  hmo: "/hmo",
  resources: "/resources",
  contact: "/contact",
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
  "vaccinations",
  "healthEducation",
  "medication",
  "labs",
  "pricing",
  "about",
  "faq",
  "corporate",
  "hmo",
  "resources",
  "contact",
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
