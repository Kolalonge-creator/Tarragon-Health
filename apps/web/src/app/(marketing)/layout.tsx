import type { Metadata } from "next";
import { MarketingNav } from "./_components/marketing-nav";
import { MarketingFooter } from "./_components/marketing-footer";
import { SITE, SITE_URL, absoluteUrl } from "@/lib/marketing/site";

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
    "ParentCare",
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
  ...(SITE.sameAs.length > 0 ? { sameAs: SITE.sameAs } : {}),
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-warm-ivory text-charcoal-ink">
      <script
        type="application/ld+json"
        // Static, first-party JSON; safe to inline for rich results.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <MarketingNav />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
