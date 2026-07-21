/**
 * Canonical marketing-site config: the public origin plus the organisation
 * facts reused across metadata, sitemap, robots, and structured data.
 * Keep the origin in sync with the Vercel domains in docs/MARKETING_SITE_SPEC.md §2.
 */

/** Public marketing origin, no trailing slash. Overridable per-environment. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://tarragonhealth.com"
).replace(/\/$/, "");

/** Build an absolute URL for a marketing path. */
export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export const SITE = {
  name: "TarragonHealth",
  legalName: "TarragonHealth",
  tagline: "Care that stays with you.",
  description:
    "Health monitoring for chronic disease, preventive health, and family care coordination in Nigeria. Track blood pressure, blood sugar, medication, labs, and preventive checks in one secure platform, with clinical review and escalation when closer care is needed.",
  /** Guard Leaf lockup, used for the Organization logo in structured data. */
  logoPath: "/brand/guard-leaf-lockup.png",
  locale: "en_NG",
  founder: "Dr Kola Longe",
  /** External profiles for Organization structured data. Add real handles only. */
  sameAs: [] as const,
} as const;
