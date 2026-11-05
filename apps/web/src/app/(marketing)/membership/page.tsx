import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { PageHero, BlockHeading } from "../_components/page-hero";
import { Section } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { EmergencyNotice } from "../_components/emergency-notice";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { HomePlanCompare } from "../_components/home-plan-compare";
import { FoundingMembersStrip } from "../_components/founding-members-strip";
import { TestimonialsSection } from "../_components/testimonials-section";
import { planFaq } from "../_content/pricing-ladder";
import { NAIRA_ONLY_STATEMENT } from "../_content/pricing";
import { SYNLAB_PARTNER_LINE } from "../_content/partners";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { faqPageJsonLd } from "@/lib/marketing/faq-json-ld";
import {
  employerSeatLine,
  employerSeatPriceLabel,
  LAB_TESTS_NOT_INCLUDED,
  MEMBERSHIP_INCLUDES,
  membershipAutoRenews,
  membershipPriceLabel,
  paidProductName,
  refundWindowDays,
  renewalCopy,
} from "@/lib/marketing/membership";

export const metadata: Metadata = pageMetadata({
  title: "Membership",
  description:
    "A year of preventive care with a doctor: a personal plan, laboratory results reviewed, a monthly online doctor meeting and reminders. One price in naira.",
  path: MARKETING_ROUTES.membership,
});

export const revalidate = 3600;

/**
 * The Membership sales page, website upgrade Phase 2 (2026-11-05, plan
 * section 7.2): everything a visitor needs to know before paying. Every price,
 * inclusion, renewal and refund sentence comes from the one shared source
 * (lib/marketing/membership.ts reads versioned config), never typed here, so
 * this page cannot disagree with /pricing or the homepage.
 */
const PAID_SEPARATELY = [
  { title: "Laboratory tests", body: "You pay the laboratory directly. Contact the laboratory for current pricing." },
  { title: "Medicines", body: "Your care team signs the prescription; you buy the medicine at any pharmacy." },
  { title: "Extra doctor meetings", body: "One online meeting a month is included. You can buy an extra one if you need it." },
] as const;

const MEMBER_YEAR = [
  { title: "Join", body: "Pay once for the year, in naira, and set up your health profile." },
  { title: "Your plan", body: "Get a preventive plan and request forms for the tests that fit you." },
  { title: "Your results", body: "Upload laboratory reports; a doctor reviews them and explains what they mean." },
  { title: "Every month", body: "Meet a doctor online, ask written questions, and get reminders when something is due." },
] as const;

export default async function MembershipPage() {
  const name = paidProductName();
  const price = membershipPriceLabel();
  const seatPrice = employerSeatPriceLabel();
  const refundDays = refundWindowDays();
  const autoRenews = await membershipAutoRenews();
  const renewal = renewalCopy(autoRenews, refundDays);
  const faq = [
    {
      question: "Where do I do my tests?",
      answer: `${SYNLAB_PARTNER_LINE} You pay the laboratory directly, then upload the report in the app.`,
    },
    {
      question: "How do the doctor meetings work?",
      answer:
        "You book your monthly online video meeting in the app, choosing from the times available. The doctor can see your record and recent results during the call. Between calls you can send written questions to your care team.",
    },
    ...planFaq(refundDays, autoRenews),
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqPageJsonLd(faq) }} />
      <PageHero
        eyebrow={name}
        title="A doctor working with you, all year."
        description={`${name} turns occasional check-ups into ongoing care: a plan made for you, your laboratory results reviewed by a doctor, a monthly online meeting and follow-up when something changes.`}
        primary={{ href: "/signup", label: `Join ${name}` }}
        secondary={{ href: "#compare", label: "Compare plans" }}
      >
        <p className="font-heading text-3xl text-charcoal-ink" data-testid="membership-price">
          {`₦${price}`} <span className="font-sans text-base text-mk-muted">a year</span>
        </p>
      </PageHero>

      <Section variant="sage" labelledBy="m-includes-title">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <BlockHeading id="m-includes-title" eyebrow="What is included" title={`Everything in ${name}.`} />
            <ul className="grid gap-3">
              {MEMBERSHIP_INCLUDES.map((line) => (
                <li key={line} className="flex items-start gap-3 text-charcoal-ink">
                  <Check aria-hidden className="mt-1 h-[18px] w-[18px] shrink-0 text-brand-green" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="self-start rounded-3xl border border-mk-border bg-white p-6">
            <h3 className="text-lg font-semibold text-charcoal-ink">Paid separately</h3>
            <ul className="mt-4 grid gap-4">
              {PAID_SEPARATELY.map((item) => (
                <li key={item.title} className="flex items-start gap-3">
                  <Minus aria-hidden className="mt-1 h-[18px] w-[18px] shrink-0 text-mk-muted" />
                  <span>
                    <span className="block font-semibold text-charcoal-ink">{item.title}</span>
                    <span className="text-[15px] text-mk-muted">{item.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section labelledBy="m-year-title">
        <BlockHeading id="m-year-title" eyebrow="Your year" title={`What a year of ${name} looks like.`} />
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MEMBER_YEAR.map((step, i) => (
            <li key={step.title} className="grid content-start gap-2 rounded-2xl border border-mk-border bg-white p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-green">Step {i + 1}</span>
              <span className="text-lg font-semibold text-charcoal-ink">{step.title}</span>
              <span className="text-[15px] text-mk-muted">{step.body}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6">
          <Link href={MARKETING_ROUTES.howItWorks} className="inline-block py-1 font-semibold text-brand-green hover:underline">
            See the whole journey step by step
          </Link>
        </p>
      </Section>

      <Section id="compare" variant="sage" labelledBy="m-compare-title">
        <BlockHeading id="m-compare-title" eyebrow="Compare" title={`Free or ${name}.`} description="Everything you do yourself in the app stays free." />
        <HomePlanCompare price={price} refundDays={refundDays} membershipIncludes={MEMBERSHIP_INCLUDES} autoRenews={autoRenews} />
      </Section>

      <FoundingMembersStrip />

      <Section labelledBy="m-pay-title">
        <BlockHeading id="m-pay-title" eyebrow="Paying, renewal and refunds" title="Clear terms, before you pay." />
        <dl className="grid gap-6 md:grid-cols-2">
          <div className="grid gap-1 border-t border-mk-border pt-4">
            <dt className="font-semibold text-charcoal-ink">Price</dt>
            <dd className="text-mk-muted">{`₦${price}`} for a year. {NAIRA_ONLY_STATEMENT}</dd>
          </div>
          <div className="grid gap-1 border-t border-mk-border pt-4">
            <dt className="font-semibold text-charcoal-ink">Renewal</dt>
            <dd className="text-mk-muted">{renewal.pricingBox}</dd>
          </div>
          <div className="grid gap-1 border-t border-mk-border pt-4">
            <dt className="font-semibold text-charcoal-ink">Refunds</dt>
            <dd className="text-mk-muted">
              You can ask for a refund within {refundDays} days of buying. After that it cannot be refunded.
            </dd>
          </div>
          <div className="grid gap-1 border-t border-mk-border pt-4">
            <dt className="font-semibold text-charcoal-ink">Not included</dt>
            <dd className="text-mk-muted">{LAB_TESTS_NOT_INCLUDED}</dd>
          </div>
        </dl>
        <p className="mt-6 text-sm text-mk-muted">
          The full terms are in our{" "}
          <Link href={MARKETING_ROUTES.terms} className="inline-block py-1 font-semibold text-brand-green hover:underline">
            Terms of Service
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage" labelledBy="m-others-title">
        <BlockHeading id="m-others-title" eyebrow="Buying for someone else" title="For a parent, a relative or your team." />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-3 rounded-2xl border border-mk-border bg-white p-6">
            <h3 className="text-lg font-semibold text-charcoal-ink">A parent or relative in Nigeria</h3>
            <p className="text-mk-muted">
              Buy a year of {name} for someone you care about. It is theirs to accept, and paying for it does not open their
              medical record to you. They can choose to share parts of their care with you through Care Circle.
            </p>
            <Link href={MARKETING_ROUTES.gift} className="inline-block py-1 font-semibold text-brand-green hover:underline">
              Support a family member
            </Link>
          </div>
          <div className="grid content-start gap-3 rounded-2xl border border-mk-border bg-white p-6">
            <h3 className="text-lg font-semibold text-charcoal-ink">Your employees</h3>
            <p className="text-mk-muted" data-testid="employer-seat-line">{employerSeatLine(seatPrice)}</p>
            <Link href={MARKETING_ROUTES.corporate} className="inline-block py-1 font-semibold text-brand-green hover:underline">
              Discuss an employer programme
            </Link>
          </div>
        </div>
      </Section>

      <TestimonialsSection />

      <Section>
        <BlockHeading id="m-faq-title" eyebrow="Questions" title={`Questions about ${name}`} />
        <FaqAccordion items={faq} variant="minimal" />
      </Section>

      <Section>
        <EmergencyNotice />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title={`Join ${name}.`}
          description="Create your account, then choose Membership when you are ready. You see the exact price before anything is charged."
          primaryHref="/signup"
          primaryLabel={`Join ${name}`}
          secondaryHref={MARKETING_ROUTES.contact}
          secondaryLabel="Talk to us first"
        />
      </Section>
    </>
  );
}
