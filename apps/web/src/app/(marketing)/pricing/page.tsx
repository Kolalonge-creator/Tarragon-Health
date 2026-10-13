import type { Metadata } from "next";
import Link from "next/link";
import { formatNaira } from "@tarragon/commerce";
import { t } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import { Section, SectionHeading } from "../_components/section";
import { PricingFreeFeatures } from "../_components/pricing-free-features";
import { PricingLabelBadge } from "../_components/pricing-label";
import { CtaBand } from "../_components/cta-band";
import { EmergencyNotice } from "../_components/emergency-notice";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { ALWAYS_FREE, ALWAYS_FREE_NOTE, EMPLOYER_HMO_NOTE, NAIRA_ONLY_STATEMENT } from "../_content/pricing";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Two plans: Free, and Membership. Membership adds a yearly blood test and a monthly video call with your care team, in naira.",
  path: MARKETING_ROUTES.pricing,
});

export const revalidate = 3600;

/** The individual Membership price, read from the versioned config (integer kobo), never typed into a page. */
function membershipPriceKobo(): number {
  const v = getProposedConfig("commerce.membership_prices").value as { individual_kobo: number };
  return v.individual_kobo;
}

/** The refund window in days, read from the versioned config (membership.refund), never typed into a page. */
function refundWindowDays(): number {
  const v = getProposedConfig("membership.refund").value as { window_days: number };
  return v.window_days;
}

const MEMBERSHIP_INCLUDES = [
  t("catalog.membership_annual.incl.1", "en"),
  t("catalog.membership_annual.incl.2", "en"),
  t("catalog.membership_annual.incl.3", "en"),
  t("catalog.membership_annual.incl.4", "en"),
] as const;

function pricingFaq(price: string, refundDays: number) {
  return [
    {
      question: "What are the two plans?",
      answer: `Free and Membership. Free is the app: tracking, reminders, education and guidance, with no time limit and no card. Membership is ₦${price} a year and adds a yearly blood test and a video call with your care team every month.`,
    },
    {
      question: "Does Membership renew by itself?",
      answer:
        "No. It lasts a year and we remind you 30, 14 and 7 days before it ends. For 14 days after it ends you keep your Member access, and your records stay with you whatever you choose.",
    },
    {
      question: "Can I get a refund?",
      answer:
        `Yes, within ${refundDays} days of buying your Membership. After ${refundDays} days it cannot be refunded. If a refund is approved your Member access ends straight away. A Membership that simply reaches the end of its year is different: you keep your Member access for 14 days after it ends.`,
    },
    {
      question: "Are medicines included?",
      answer: "No. Your care team signs a prescription and you take it to any pharmacy and pay there.",
    },
    {
      question: "Can my employer pay for me?",
      answer:
        "Yes. An employer can cover its employees. If your employer pays you do not pay anything yourself, and your employer only ever sees counts, never anything about you.",
    },
  ];
}

export default async function PricingPage() {
  const price = formatNaira(membershipPriceKobo());
  const refundDays = refundWindowDays();
  const faq = pricingFaq(price, refundDays);
  /** FAQPage structured data for the pricing questions; eligible for rich results. */
  const pricingFaqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingFaqJsonLd) }} />
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Pricing"
          title="Free, or Membership. Nothing in between."
          description="Everything you can do yourself costs nothing, with no time limit and no card required. Membership adds a yearly blood test and a video call with your care team every month."
        />
        <p className="mx-auto mb-10 max-w-2xl text-center text-sm font-medium text-deep-forest">{NAIRA_ONLY_STATEMENT}</p>
        <PricingFreeFeatures />
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={MARKETING_ROUTES.contact}>Talk to us first</Link>
          </Button>
        </div>
        <p className="mt-6 text-center text-sm text-charcoal-ink/70">
          Want the full picture first? Read our{" "}
          <Link href={MARKETING_ROUTES.howPricingWorks} className="font-semibold text-brand-green underline underline-offset-2">
            No-Hidden-Cost Promise and how we compare to your HMO
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Membership"
          title={`${t("catalog.membership_annual.name", "en")}: ₦${price} a year`}
          description={t("catalog.membership_annual.description", "en")}
        />
        <div className="mx-auto max-w-2xl rounded-xl border border-brand-green/20 bg-white p-6">
          <ul className="space-y-2 text-sm leading-relaxed text-charcoal-ink/80">
            {MEMBERSHIP_INCLUDES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-charcoal-ink/70">
            It lasts a year and does not renew by itself. We remind you before it ends, and you keep your Member access for 14 days after.
          </p>
          <p className="mt-2 text-sm text-charcoal-ink/70">
            Refunds: within {refundDays} days of buying it. After that it cannot be refunded.
          </p>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="What's always free" title="Free, and not from us" />
        <div className="mx-auto max-w-2xl">
          <div className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{ALWAYS_FREE.feature}</h3>
              <PricingLabelBadge label={ALWAYS_FREE.label} />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{ALWAYS_FREE.description}</p>
          </div>
          <p className="mt-6 text-center text-sm text-charcoal-ink/70">{ALWAYS_FREE_NOTE}</p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Questions" title="Frequently asked questions" />
        <FaqAccordion items={faq} variant="minimal" />
      </Section>

      <Section>
        <SectionHeading eyebrow="Employers, HMOs & institutions" title="Covering a workforce or member population?" />
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-charcoal-ink/70">{EMPLOYER_HMO_NOTE}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href={`${MARKETING_ROUTES.contact}?source=corporate`}>Request employer health plan</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={`${MARKETING_ROUTES.contact}?source=hmo`}>Talk to us about HMO partnerships</Link>
            </Button>
          </div>
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <EmergencyNotice className="mb-10" />
        <CtaBand
          variant="gradient"
          title="Ready to get started?"
          description="Join TarragonHealth today, for yourself or someone you love."
          secondaryHref={MARKETING_ROUTES.contact}
          secondaryLabel="Talk to us first"
        />
      </Section>
    </>
  );
}
