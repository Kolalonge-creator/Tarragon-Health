import type { Metadata } from "next";
import Link from "next/link";
import { formatNaira } from "@tarragon/commerce";
import { t } from "@tarragon/i18n";
import { getProposedConfig } from "@tarragon/shared";
import { MEMBERSHIP_INCLUDES, paidProductName, membershipAutoRenews, membershipPriceLabel, refundWindowDays, renewalCopy } from "@/lib/marketing/membership";
import { Section, SectionHeading } from "../_components/section";
import { PricingFreeFeatures } from "../_components/pricing-free-features";
import { PricingLabelBadge } from "../_components/pricing-label";
import { CtaBand } from "../_components/cta-band";
import { TestimonialsSection } from "../_components/testimonials-section";
import { EmergencyNotice } from "../_components/emergency-notice";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { Button } from "@/components/ui/button";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { PanelTests } from "../_components/panel-tests";
import { ladderCards, ladderFaq, LADDER_SAFETY_STATEMENT, LADDER_SAME_CARE_STATEMENT } from "../_content/pricing-ladder";
import { ALWAYS_FREE, ALWAYS_FREE_NOTE, EMPLOYER_HMO_NOTE, NAIRA_ONLY_STATEMENT } from "../_content/pricing";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description:
    "Free, and a paid year of care with a monthly video call with your care team, in naira. You see the price before you pay.",
  path: MARKETING_ROUTES.pricing,
});

export const revalidate = 3600;

/** Whether the three-card ladder is public (marketing.membership_ladder_public). False until the launch conditions are met. */
function ladderIsPublic(): boolean {
  return (getProposedConfig("marketing.membership_ladder_public").value as { enabled: boolean }).enabled === true;
}

/** The two paid prices, read from the versioned config (commerce.membership_ladder, integer kobo), never typed into a page. */
function ladderPriceKobo(): { evergreen: number; evergreenPlus: number } {
  const v = getProposedConfig("commerce.membership_ladder").value as { evergreen_kobo: number; evergreen_plus_kobo: number };
  return { evergreen: v.evergreen_kobo, evergreenPlus: v.evergreen_plus_kobo };
}

function pricingFaq(price: string, refundDays: number, autoRenews: boolean) {
  // Ladder OFF: the one product on sale is the catalogue's membership_annual (it includes the blood panel), named as the catalogue names it.
  const product = paidProductName();
  return [
    {
      question: "What are the two plans?",
      answer: `Free and ${product}. Free is the app: tracking, reminders, education and guidance, with no time limit and no card. ${product} is ₦${price} a year. It includes a yearly blood test collected for you and a video call with your care team every month. Anyone, on any plan, can also request the annual test bundle and pay the laboratory directly.`,
    },
    {
      question: `Does ${product} renew by itself?`,
      answer: renewalCopy(autoRenews, refundDays).faqAnswer,
    },
    {
      question: "Can I get a refund?",
      answer:
        `Yes, within ${refundDays} days of buying your ${product}. After ${refundDays} days it cannot be refunded. If a refund is approved your Member access ends straight away. A ${product} year that simply reaches the end of its year is different: you keep your Member access for 14 days after it ends.`,
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

function LadderPricing({ refundDays, autoRenews }: { refundDays: number; autoRenews: boolean }) {
  const kobo = ladderPriceKobo();
  const cards = ladderCards({ evergreen: `₦${formatNaira(kobo.evergreen)}`, evergreenPlus: `₦${formatNaira(kobo.evergreenPlus)}` });
  const faq = ladderFaq(refundDays, autoRenews);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <Section className="pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Pricing"
          title="Free, Membership or Membership Plus"
          description="Everything you can do yourself costs nothing. Membership and Membership Plus are a year of care with your care team. The one difference is the yearly blood panel."
        />
        <p className="mx-auto mb-4 max-w-2xl text-center text-sm font-medium text-deep-forest">{NAIRA_ONLY_STATEMENT}</p>
        <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-charcoal-ink/70">{LADDER_SAME_CARE_STATEMENT}</p>
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3" data-testid="ladder-cards">
          {cards.map((card) => (
            <section key={card.id} aria-labelledby={`tier-${card.id}`} className="rounded-xl border border-brand-green/20 bg-white p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-green">{card.difference}</p>
              <h2 id={`tier-${card.id}`} className="mt-2 font-heading text-xl font-semibold text-charcoal-ink">
                {card.name}
              </h2>
              <p className="mt-1 text-lg font-semibold text-charcoal-ink">{card.priceLine}</p>
              <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">{card.summary}</p>
              <ul className="mt-4 space-y-2 text-sm leading-relaxed text-charcoal-ink/80">
                {card.includes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {card.panelTests ? <PanelTests groups={card.panelTests} /> : null}
            </section>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-charcoal-ink/70">{LADDER_SAFETY_STATEMENT}</p>
        <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-charcoal-ink/70">
          {renewalCopy(autoRenews, refundDays).short}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={MARKETING_ROUTES.contact}>Talk to us first</Link>
          </Button>
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

export default async function PricingPage() {
  if (ladderIsPublic()) return <LadderPricing refundDays={refundWindowDays()} autoRenews={await membershipAutoRenews()} />;
  const price = membershipPriceLabel();
  const refundDays = refundWindowDays();
  const autoRenews = await membershipAutoRenews();
  const faq = pricingFaq(price, refundDays, autoRenews);
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
          title={`Free, or ${paidProductName()}. Nothing in between.`}
          description={`Everything you can do yourself costs nothing, with no time limit and no card required. ${paidProductName()} includes a yearly blood test collected for you and a video call with your care team every month.`}
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
          eyebrow={paidProductName()}
          title={`${paidProductName()}: ₦${price} a year`}
          description={t("catalog.membership_annual.description", "en")}
        />
        <div className="mx-auto max-w-2xl rounded-xl border border-brand-green/20 bg-white p-6">
          <ul className="space-y-2 text-sm leading-relaxed text-charcoal-ink/80">
            {MEMBERSHIP_INCLUDES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-charcoal-ink/70">
            {renewalCopy(autoRenews, refundDays).pricingBox}
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

      {/* Real, consented, published quotes only; renders nothing until there are some. */}
      <TestimonialsSection />

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
