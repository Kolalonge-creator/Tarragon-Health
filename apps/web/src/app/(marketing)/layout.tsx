import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { MarketingNav } from "./_components/marketing-nav";
import { MarketingFooter } from "./_components/marketing-footer";
import { BreadcrumbJsonLd } from "./_components/breadcrumb-json-ld";
import { StickyCtaBar } from "./_components/sticky-cta-bar";
import { FrontDeskChat } from "./_components/frontdesk-chat";
import { SITE, SITE_URL, absoluteUrl } from "@/lib/marketing/site";

/**
 * Heading face for the public site only (founder decision W-08, 2026-11-05).
 * Loaded here, not in the root layout, so the signed-in app never downloads
 * it. Self-hosted by next/font, so no runtime Google request and no CSP change.
 */
const fraunces = Fraunces({
  // latin-ext carries the naira sign (U+20A6); the plain latin subset does
  // not, so prices fell back to a different font. Browsers download the
  // latin-ext file only on pages that actually show a naira sign.
  subsets: ["latin", "latin-ext"],
  variable: "--font-fraunces",
  axes: ["opsz"],
  display: "swap",
});

const DEFAULT_TITLE = `${SITE.name} | ${SITE.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "chronic disease management Nigeria",
    "blood pressure monitoring",
    "diabetes management",
    "preventive health",
    "care coordination",
    "caring for a parent",
    "health monitoring",
    "HMO",
    "corporate wellness Nigeria",
  ],
  openGraph: {
    type: "website",
    siteName: SITE.name,
    url: SITE_URL,
    locale: SITE.locale,
  },
  twitter: {
    card: "summary_large_image",
    site: `@${SITE.twitterHandle}`,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

/** schema.org Organization; grounds brand identity for search + AI answers. */
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "MedicalOrganization",
  name: SITE.name,
  legalName: SITE.legalName,
  url: SITE_URL,
  logo: absoluteUrl(SITE.logoPath),
  slogan: SITE.tagline,
  description: SITE.description,
  areaServed: { "@type": "Country", name: "Nigeria" },
  founder: { "@type": "Person", name: SITE.founder },
  // Contact facts, all already published in the footer. Without these the
  // Organization node was brand-only, so nothing tied the phone number or the
  // company registration to the entity a search engine resolves.
  telephone: SITE.telephone,
  email: SITE.email,
  identifier: SITE.registrationNumber,
  // Locality-level only: this is the registered headquarters, not a place a
  // patient attends. Tarragon runs no clinics and publishes no street address,
  // and a fabricated one would be worse than none.
  address: {
    "@type": "PostalAddress",
    addressLocality: SITE.addressLocality,
    addressRegion: SITE.addressRegion,
    addressCountry: SITE.addressCountry,
  },
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer support",
      telephone: SITE.telephone,
      email: SITE.supportEmail,
      areaServed: "NG",
      availableLanguage: ["English"],
    },
    {
      "@type": "ContactPoint",
      contactType: "sales",
      email: SITE.email,
      areaServed: "NG",
      availableLanguage: ["English"],
    },
  ],
  ...(SITE.sameAs.length > 0 ? { sameAs: SITE.sameAs } : {}),
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`marketing-scope ${fraunces.variable} flex min-h-screen flex-col`}>
      <script
        type="application/ld+json"
        // Static, first-party JSON; safe to inline for rich results.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <BreadcrumbJsonLd />
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-full bg-brand-green px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <MarketingNav />
      <main id="main-content" className="flex-1">{children}</main>
      <MarketingFooter />
      <StickyCtaBar />
      <FrontDeskChat />
    </div>
  );
}
