import { notFound } from "next/navigation";
import { ProductPageTemplate } from "../_components/product-page-template";
import { getProductPage } from "../_content/products";
import { Section } from "../_components/section";
import { ResourceCarousel } from "../_components/resource-carousel";
import { PhoneMockup } from "../_components/phone-mockup";
import { loadResourceArticles } from "@/lib/marketing/resources-data";
import Image from "next/image";
import Link from "next/link";
import { BlockHeading } from "../_components/page-hero";
import { PARTNER_LOGOS, SYNLAB_PARTNER_LINE } from "../_content/partners";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const revalidate = 300;

export function generateMetadata() {
  const content = getProductPage("labs");
  return content?.metadata ?? {};
}

// No resource-article "Labs" category exists, so this page curates by slug
// rather than filtering by category the way the condition pages do.
const LABS_RESOURCE_SLUGS = [
  "annual-health-check-guide",
  "abnormal-screening-result-what-happens-next",
];

export default async function LabsPage() {
  const content = getProductPage("labs");
  if (!content) notFound();

  const articles = await loadResourceArticles();
  const labsArticles = articles.filter((a) => LABS_RESOURCE_SLUGS.includes(a.slug));
  // The /labs partner panel is one of the three places Synlab appears (founder decision W-06).
  const synlab = PARTNER_LOGOS.find((p) => p.name === "Synlab");

  return (
    <ProductPageTemplate content={content}>
      <Section>
        <div className="mx-auto grid max-w-4xl items-center gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
          <PhoneMockup
            className="relative mx-auto"
            src="/marketing/photos/app-labs-results.png"
            alt="The TarragonHealth app's Labs & results screen, with options to photograph a result or view past orders and results."
            width={1080}
            height={2238}
          />
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              Any laboratory, one record
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Photograph a result and we add it to your record
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              You pay the laboratory directly and can have the test wherever you like. Take a photo
              of the result and it is added to your record and explained in plain language; on
              Membership a doctor reviews it.
            </p>
            {synlab ? (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl border border-mk-border bg-white px-5 py-4 lg:justify-start">
                <span className="text-xs font-semibold uppercase tracking-wider text-mk-muted">Our laboratory partner</span>
                <Image src={synlab.logoSrc} alt="Synlab" width={123} height={28} className="h-7 w-auto" />
                <p className="w-full text-[15px] text-charcoal-ink">{SYNLAB_PARTNER_LINE}</p>
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      {/* For providers (plan section 7.6). No self-service listing exists, so
          this routes to an enquiry and promises no approval or listing date. */}
      <Section id="providers" labelledBy="labs-providers-title">
        <BlockHeading
          id="labs-providers-title"
          eyebrow="For laboratories and imaging centres"
          title="Join our diagnostic directory."
          description="Patients take their request forms to eligible laboratories and imaging centres listed in our directory. We list a provider after checking its registration, its branches and the services each branch offers."
        />
        <ul className="grid gap-3 text-charcoal-ink/85 md:grid-cols-3">
          <li className="border-t border-mk-border pt-3">Your registration details, including MLSCN registration where it applies</li>
          <li className="border-t border-mk-border pt-3">Each branch: address, opening hours and contact details</li>
          <li className="border-t border-mk-border pt-3">The tests or scans each branch offers, and any accreditation you hold</li>
        </ul>
        <p className="mt-4 text-[15px] text-mk-muted">Listing is not automatic and is not a quality accreditation. We will reply to tell you what we need from you.</p>
        <Link
          href={`${MARKETING_ROUTES.contact}?source=lab-provider&role=other`}
          className="mt-6 inline-flex h-12 items-center justify-center rounded-full border-[1.5px] border-brand-green px-6 font-semibold text-brand-green hover:bg-brand-green/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          Join the provider network
        </Link>
      </Section>

      {labsArticles.length > 0 ? (
        <Section variant="sage">
          <ResourceCarousel title="More resources on laboratory tests" articles={labsArticles} />
        </Section>
      ) : null}
    </ProductPageTemplate>
  );
}
