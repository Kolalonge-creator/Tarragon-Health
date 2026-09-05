/**
 * Canonical marketing-site config: the public origin plus the organisation
 * facts reused across metadata, sitemap, robots, and structured data.
 * Keep the origin in sync with the Vercel domains in docs/MARKETING_SITE_SPEC.md §2.
 */
import type { Metadata } from "next";

/** Public marketing origin, no trailing slash. Overridable per-environment. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://tarragonhealth.ng"
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
  /** X/Twitter @handle, no leading "@" trimmed off — used for the twitter:site meta tag. */
  twitterHandle: "Tarragonhealth",
  /**
   * Contact facts, all of them already published in the site footer. They
   * feed the Organization structured data as well, which is what lets a
   * search engine or an AI answer attach a phone number and a company
   * registration to this brand instead of guessing.
   *
   * No street address: Tarragon has no public premises to publish (no owned
   * clinics), so the postal address is country-level only. Do not invent one.
   */
  telephone: "+2348061197940",
  email: "hello@tarragonhealth.ng",
  supportEmail: "support@tarragonhealth.ng",
  /** Corporate Affairs Commission registration number, as shown in the footer. */
  registrationNumber: "RC 9702108",
  addressCountry: "NG",
  /** External profiles for Organization structured data. Add real handles only. */
  sameAs: [
    "https://www.facebook.com/Tarragonhealth",
    "https://www.instagram.com/Tarragonhealth",
    "https://x.com/Tarragonhealth",
  ] as const,
} as const;

/**
 * Per-page OG/Twitter/canonical metadata. When a segment declares its own
 * `openGraph`/`twitter` key, Next's resolver (resolve-metadata.js) replaces
 * the parent's *entire resolved object* with the segment's own — it does not
 * merge field-by-field and does not fall back to the parent for fields the
 * segment omits (confirmed by reading resolveOpenGraph/resolveTwitter in
 * node_modules/next/dist/lib/metadata/resolvers/resolve-opengraph.js: both
 * only read off the object passed in for that segment). So every page must
 * restate type/siteName/locale/site here too, not just title/description/url
 * — omitting them doesn't inherit the layout's values, it drops the fields
 * entirely.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = "website",
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
}): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type,
      siteName: SITE.name,
      locale: SITE.locale,
      title,
      description,
      url,
    },
    twitter: {
      // Stated explicitly, not left to resolveTwitter's own default: that
      // default is computed before the final cross-fill from openGraph.images
      // runs (see postProcessMetadata in resolve-metadata.js), so an image
      // that exists ends up attached to a "summary" card unless card is set
      // up front.
      card: "summary_large_image",
      site: `@${SITE.twitterHandle}`,
      title,
      description,
    },
  };
}
