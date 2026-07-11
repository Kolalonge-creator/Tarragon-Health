/** Public marketing routes — keep in sync with nav, proxy public-path allowlist, and MARKETING_SITE_SPEC.md §2. */

export const MARKETING_ROUTES = {
  home: "/",
  hypertension: "/hypertension",
  diabetes: "/diabetes",
  parentcare: "/parentcare",
  prevention: "/prevention",
  medication: "/medication",
  labs: "/labs",
  pricing: "/pricing",
  about: "/about",
  corporate: "/corporate",
  hmo: "/hmo",
  contact: "/contact",
} as const;

export type MarketingRouteKey = keyof typeof MARKETING_ROUTES;

/** Routes built in the current scaffold pass (update as pages ship). */
export const MARKETING_ROUTES_BUILT: MarketingRouteKey[] = [
  "home",
  "hypertension",
  "diabetes",
  "parentcare",
  "prevention",
  "medication",
  "labs",
  "pricing",
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

/**
 * `/corporate` and `/hmo` collide with platform dashboard routes.
 * Marketing pages for those URLs require hostname rewrites — not built yet.
 * See docs/MARKETING_SITE_SPEC.md § Build Progress.
 */
export const MARKETING_PATH_COLLISIONS = ["/corporate", "/hmo"] as const;
