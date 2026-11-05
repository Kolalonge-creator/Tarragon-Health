import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, BlockHeading } from "../_components/page-hero";
import { Section } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { CareCircleAbroad } from "../_components/care-circle-abroad";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { faqPageJsonLd } from "@/lib/marketing/faq-json-ld";
import { paidProductName } from "@/lib/marketing/membership";

export const metadata: Metadata = pageMetadata({
  title: "For families",
  description:
    "Support a parent or relative in Nigeria from anywhere: pay for their Membership, and follow the parts of their care they choose to share with you.",
  path: MARKETING_ROUTES.families,
});

/**
 * For families, website upgrade Phase 3 (2026-11-05, plan section 7.4). A
 * hub for the two separate things a relative can do: pay for someone's
 * Membership (the full flow and its terms live on /gift) and follow their care
 * through Care Circle (the live, consent-based sharing explained by
 * CareCircleAbroad). The rule that runs through both: paying is never access.
 * Individual enrolment only; there is no family plan (founder decision
 * 2026-07-29).
 */
const PRINCIPLES = [
  { title: "Their care, their choice", body: "The person you support decides who sees what, and can pause or stop sharing at any time." },
  { title: "Paying is not access", body: "Paying for someone's Membership does not open their medical record to you." },
  { title: "One person, one record", body: "Each person has their own account and their own care team. There is no shared family account." },
] as const;

const FAQ = [
  {
    question: "Can I pay for my mother's Membership from the UK?",
    answer: "Yes. You pay in naira wherever you are paying from, and the Membership is hers to accept. The payment, acceptance and refund terms are set out on our page about giving a Membership.",
  },
  {
    question: "Will I see my father's results?",
    answer: "Only if he chooses to share them. With Care Circle he picks what you can see, such as weekly blood pressure averages or upcoming appointments. Sensitive tests are never shared.",
  },
  {
    question: "Can I set up an account for my parent?",
    answer: "Your parent creates their own account, and you can help them do it. If they need more help, they can choose to let you manage bookings for them, and either of you can end that at any time.",
  },
  {
    question: "Is there a family plan?",
    answer: "No. Each person has their own Membership, so each person keeps their own private record. You can pay for more than one person.",
  },
] as const;

export default function FamiliesPage() {
  const name = paidProductName();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqPageJsonLd(FAQ) }} />
      <PageHero
        image={{ src: "/marketing/photos/hero/gift.jpg", alt: "A grandmother, mother and child together outdoors", width: 1400, height: 1750 }}
        eyebrow="For families"
        title="Stay close to the health of the people you love."
        description={`Whether you live in Lagos, London, Houston or Toronto, you can help a parent or relative in Nigeria get ongoing care: pay for their ${name}, and follow the parts of their care they choose to share with you.`}
        primary={{ href: MARKETING_ROUTES.gift, label: "Support a family member" }}
        secondary={{ href: "#care-circle", label: "How Care Circle works" }}
      />

      <Section variant="sage" labelledBy="fam-ways-title">
        <BlockHeading id="fam-ways-title" eyebrow="Two ways to help" title="Pay for their care, and stay in the loop." />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid content-start gap-3 rounded-2xl bg-white p-6">
            <h3 className="text-xl font-semibold text-charcoal-ink">Pay for their {name}</h3>
            <p className="text-mk-muted">
              Give a year of {name}: their own preventive plan, a doctor&apos;s review of their laboratory results and a monthly online
              doctor meeting. They accept it in their own words, and nothing starts before they do.
            </p>
            <Link href={MARKETING_ROUTES.gift} className="inline-block py-1 font-semibold text-brand-green hover:underline">
              How giving a Membership works
            </Link>
          </div>
          <div className="grid content-start gap-3 rounded-2xl bg-white p-6">
            <h3 className="text-xl font-semibold text-charcoal-ink">Follow their care with Care Circle</h3>
            <p className="text-mk-muted">
              They invite you, and choose what you can see: for example weekly blood pressure averages, doses taken and upcoming
              appointments. You get enough to know how they are doing; they stay in charge.
            </p>
            <Link href="#care-circle" className="inline-block py-1 font-semibold text-brand-green hover:underline">
              See what can be shared
            </Link>
          </div>
        </div>
      </Section>

      <Section labelledBy="fam-rules-title">
        <BlockHeading id="fam-rules-title" eyebrow="Privacy" title="Built around their consent." />
        <ul className="grid gap-4 md:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <li key={p.title} className="grid gap-1 border-t-2 border-brand-green pt-3">
              <span className="font-semibold text-charcoal-ink">{p.title}</span>
              <span className="text-mk-muted">{p.body}</span>
            </li>
          ))}
        </ul>
      </Section>

      <CareCircleAbroad variant="sage" id="care-circle" />

      <Section>
        <BlockHeading id="fam-faq-title" eyebrow="Questions" title="Common questions from families" />
        <FaqAccordion items={[...FAQ]} variant="minimal" />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Help someone you love get ongoing care."
          description="Pay for their Membership, or invite them to join for free."
          primaryHref={MARKETING_ROUTES.gift}
          primaryLabel="Support a family member"
          secondaryHref="/signup"
          secondaryLabel="Create a free account"
        />
      </Section>
    </>
  );
}
