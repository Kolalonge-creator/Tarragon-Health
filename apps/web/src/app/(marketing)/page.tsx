import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { CtaBand } from "./_components/cta-band";
import { Section, SectionHeading } from "./_components/section";
import { TestimonialsSection } from "./_components/testimonials-section";
import { DoctorTestimonialsSection } from "./_components/doctor-testimonials-section";
import { EmergencyNotice } from "./_components/emergency-notice";
import { FaqAccordion } from "./_components/marketing-faq-accordion";
import { HomePlanCompare } from "./_components/home-plan-compare";
import { FoundingMembersStrip } from "./_components/founding-members-strip";
import { HomeHero, HomeHeroFallback } from "./_components/home-hero";
import {
  HomeAudienceRouter,
  HomeClinicalOversight,
  HomeDiagnosticNetwork,
  HomeEmployers,
  HomeFamilies,
  HomeJourney,
  HomeProblem,
  HomeServices,
  HomeShowcase,
} from "./_components/home-sections";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { employerSeatPriceLabel, LAB_TESTS_NOT_INCLUDED, MEMBERSHIP_INCLUDES, paidProductName, membershipAutoRenews, membershipPriceLabel, refundWindowDays, renewalCopy } from "@/lib/marketing/membership";

const HOME_TITLE = "TarragonHealth | Care that stays with you";

/**
 * The marketing layout sets `title.template = "%s | TarragonHealth"`, which
 * would render this page's already-branded title as
 * "TarragonHealth | Care that stays with you | TarragonHealth" (76 chars,
 * truncated in search results). `title.absolute` opts this one page out of
 * the template; every other page keeps it, because their titles are the bare
 * page name. openGraph/twitter titles are unaffected by the template, so they
 * stay as pageMetadata built them.
 */
export const metadata: Metadata = {
  ...pageMetadata({
    title: HOME_TITLE,
    // Kept <= 160 chars: apps/web/src/lib/marketing/page-metadata.test.ts
    // enforces MAX_DESCRIPTION = 160 as a hard stop across every marketing
    // page (Google truncates a listing there).
    description:
      "Preventive care in Nigeria: a personal health plan, lab results reviewed by a doctor, and follow-up all year. Free to join, with Membership when you want more.",
    path: "/",
  }),
  title: { absolute: HOME_TITLE },
};

/**
 * ISR, not per-request rendering. The only live data on this page is the
 * testimonials blocks (anon key, published rows only), and an hour-stale
 * quote is fine; docs/MARKETING_SITE_SPEC.md §4 requires marketing pages to
 * be static or ISR.
 */
export const revalidate = 3600;

/**
 * Four questions a first-time visitor actually has, answered with the same
 * facts /pricing and /services state. FAQPage structured data is emitted for
 * them below. Redesign 2026-10-26: the homepage previously had no FAQ at all.
 */
function homeFaq(price: string, refundDays: number, autoRenews: boolean) {
  return [
    {
      question: "Is Tarragon really free?",
      answer: `Yes. The app is free, with no time limit and no payment card needed. ${paidProductName()} is optional: ₦${price} a year, with a personalised preventive plan, one online meeting with a doctor from your care team each month, and a doctor's review of the laboratory reports you upload. ${LAB_TESTS_NOT_INCLUDED}`,
    },
    {
      question: "Do I need a diagnosis to join?",
      answer:
        "No. Many people join to stay well. Your preventive plan is based on your age, history and family history. If you do have a condition, we follow it between your appointments.",
    },
    {
      question: "What happens if a reading is dangerous?",
      answer:
        "You receive clear guidance and a specific next step straight away. If you do not acknowledge a dangerous reading, the person you named as your next of kin is contacted as well.",
    },
    {
      question: `Does ${paidProductName()} renew by itself?`,
      answer: renewalCopy(autoRenews, refundDays).faqAnswer,
    },
  ];
}

/**
 * Homepage, rebuilt 2026-11-05 (website upgrade Phase 1,
 * docs/plans/website-redesign/00-phase0-plan.md section 4). Thirteen sections,
 * one idea each, in the plan's order. Prices come from versioned config
 * (membershipPriceLabel, employerSeatPriceLabel), never typed.
 */
export default async function MarketingHomePage() {
  const price = membershipPriceLabel();
  const refundDays = refundWindowDays();
  const autoRenews = await membershipAutoRenews();
  const seatPrice = employerSeatPriceLabel();
  const faq = homeFaq(price, refundDays, autoRenews);
  const faqJsonLd = {
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
      />

      {/* 1. Hero. `?channel=` campaign copy is read on the client so the page
          stays static; the fallback is the default copy most visitors see. */}
      <Suspense fallback={<HomeHeroFallback />}>
        <HomeHero />
      </Suspense>

      {/* 2. Who it is for. */}
      <HomeAudienceRouter />

      {/* 3. The problem, 4. the journey, 5. the app. */}
      <div className="pt-6" />
      <HomeProblem />
      <HomeJourney />
      <HomeShowcase />

      {/* 6. Services. */}
      <HomeServices />

      {/* 7. Membership: Free vs Membership, price from config. */}
      <Section id="membership" labelledBy="home-membership-title">
        <div className="mb-10 grid max-w-3xl gap-3">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-green">Membership</p>
          <h2 id="home-membership-title" className="text-balance font-heading text-3xl font-medium leading-tight text-charcoal-ink sm:text-4xl">
            Healthcare that stays with you.
          </h2>
          <p className="text-lg text-charcoal-ink/80">
            Start free. Join {paidProductName()} when you want a doctor working with you all year.
          </p>
        </div>
        <HomePlanCompare price={price} refundDays={refundDays} membershipIncludes={MEMBERSHIP_INCLUDES} autoRenews={autoRenews} />
        <p className="mt-6 text-center">
          <Link href={MARKETING_ROUTES.pricing} className="inline-block py-2 font-semibold text-brand-green hover:underline">
            Compare plans in full
          </Link>
        </p>
      </Section>

      {/* The founding member offer: renders nothing unless it is open. */}
      <FoundingMembersStrip />

      {/* 8. Diagnostic network, with the Synlab partner line (W-06). */}
      <HomeDiagnosticNetwork />

      {/* 9. Families, 10. employers, 11. clinical oversight. */}
      <HomeFamilies />
      <HomeEmployers seatPrice={`₦${seatPrice}`} />
      <HomeClinicalOversight />

      {/* 12. Real, consented testimonials only; these render nothing until one is published. */}
      <TestimonialsSection />
      <DoctorTestimonialsSection />

      <Section variant="sage">
        <SectionHeading eyebrow="Questions" title="Questions before you sign up" />
        <FaqAccordion items={faq} variant="minimal" />
        <p className="mt-6 text-center text-sm">
          <Link href={MARKETING_ROUTES.faq} className="inline-block py-2 font-medium text-brand-green hover:underline">
            More questions and answers
          </Link>
        </p>
      </Section>

      <Section>
        <EmergencyNotice />
      </Section>

      {/* 13. Closing call to action. */}
      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Start taking a more proactive approach to your health."
          description="Create a free account in a few minutes, for yourself or for someone you care for."
          primaryHref="/signup"
          primaryLabel="Get started"
        />
      </Section>
    </>
  );
}
