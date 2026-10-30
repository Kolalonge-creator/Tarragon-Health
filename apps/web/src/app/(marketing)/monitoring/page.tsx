import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { membershipAutoRenews, renewalCopy } from "@/lib/marketing/membership";


/**
 * Continuous Monitoring.
 *
 * THE LINE THIS PAGE MUST NOT CROSS. An unmonitored patient is not unsafe and
 * must never be told they are. Every reading logged on this platform is checked
 * against care protocols whatever anyone pays, and the emergency safety net --
 * acknowledge-gated guidance, emergency contact notified, follow-up afterwards
 * -- has never depended on payment and never will. What this product adds is
 * that a doctor on the care team is TOLD.
 *
 * That distinction is the whole product and also the whole risk. Selling it
 * with fear ("without this, nobody is watching") would be both against the
 * brand voice rules and untrue, and the version of that sentence which IS true
 * is quieter and better: your reading already gets checked, this is who hears
 * about it.
 *
 * FREE OR MEMBER, NOTHING ELSE. Continuous monitoring is no longer a product with its own price: a doctor on the care team being
 * told, and following up, is part of Membership. This page describes Free and Membership only and states no price.
 */

export const metadata: Metadata = pageMetadata({
  title: "Continuous monitoring",
  description:
    "Every reading you log is checked against care protocols. This is what puts a dangerous one in front of a doctor instead of leaving it on your record.",
  path: MARKETING_ROUTES.monitoring,
});

const WHAT_HAPPENS = [
  {
    when: "When you record a reading",
    body: "Your reading is checked against the care protocol for your age, sex and conditions. This happens on every plan, including the free plan, and always has.",
  },
  {
    when: "If the reading is dangerous",
    body: "You receive clear guidance immediately, your emergency contact is notified, and we check in with you afterwards. None of this depends on payment.",
  },
  {
    when: "What Membership adds",
    body: "A doctor on your care team is told about the reading and follows up with you personally. On the free plan, a worrying reading stays on your record until you or someone else reviews it.",
  },
  {
    when: "Between dangerous readings",
    body: "Trends are monitored as well as single readings, and your screening calendar continues alongside.",
  },
];

const FAQ = [
  {
    question: "What happens to my readings on the free plan?",
    answer:
      "Every reading is still checked against care protocols, and you still receive the full emergency safety net: immediate guidance, your emergency contact notified, and a check-in afterwards. On the free plan a doctor is not told, and we say so plainly on the screen. Membership is what brings a doctor on your care team into the process.",
  },
  {
    question: "Is this insurance?",
    answer:
      "No, and it does not replace insurance. A health maintenance organisation (HMO) pays your bills on the day you are admitted to hospital. This service monitors your readings in the years before that day, so that admission may come later or not at all.",
  },
  {
    question: "Does Membership renew automatically?",
    answer:
      "No. It lasts a year. We remind you 30, 14 and 7 days before it ends, and you keep your Member access for 14 days after. There is no card kept on file and nothing to cancel.",
  },
  {
    question: "What counts as a dangerous reading?",
    answer:
      "Blood pressure, blood sugar, oxygen level, temperature and pulse each have thresholds that are set from clinical guidelines and approved by our clinical director. The thresholds are the same on both plans.",
  },
  {
    question: "Do I need Membership for hypertension or diabetes?",
    answer:
      "You do not need it to use the app, and the self-monitoring track of the chronic care programme is free. Membership gives you a doctor who reviews your readings and adjusts your plan.",
  },
];

export const revalidate = 3600;

export default async function MonitoringPage() {
  const autoRenews = await membershipAutoRenews();
  // the renewal answer is the one sentence on this page that follows the platform's real renewal switch
  const faq = FAQ.map((f) => (f.question === "Does Membership renew automatically?" ? { ...f, answer: renewalCopy(autoRenews, 0).monitoringAnswer } : f));
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          size="large"
          eyebrow="Continuous monitoring"
          title="A doctor is told when it matters"
          description="Your readings are already checked against care protocols, whatever you pay. This is what puts a dangerous one in front of a doctor on your care team, instead of leaving it on your record for someone to find later."
        />

        <div className="mx-auto max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            Most of what goes wrong in hypertension and diabetes does not announce itself. It shows
            up as a reading that is slightly worse than last month, then slightly worse again, in a
            record that nobody is reading.
          </p>
          <p>
            Checking readings is inexpensive, so we do it for everyone. Having a doctor who notices
            and responds is what costs money, so that is the part we charge for.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What actually happens"
          title="What is free on both plans, and the one thing that is not"
        />
        <ol className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2">
          {WHAT_HAPPENS.map((item) => (
            <li
              key={item.when}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
            >
              <h3 className="font-heading text-base font-semibold text-charcoal-ink">{item.when}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">{item.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Two plans"
          title="Free, or Membership"
          description="Every reading is checked on both. Membership is what adds a doctor who is told and follows up."
        />
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm">
            <p className="font-heading text-lg font-semibold text-charcoal-ink">Free</p>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Every reading is checked, you receive immediate guidance, your emergency contact is told, and we check in with you afterwards. There is no time limit and no payment card is needed.
            </p>
          </div>
          <div className="rounded-2xl border border-brand-green/25 bg-white p-6 shadow-sm">
            <p className="font-heading text-lg font-semibold text-charcoal-ink">Membership</p>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Everything in Free, and a doctor on your care team is told about a dangerous reading and follows up with you. Your price is shown on the pricing page.
            </p>
          </div>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Questions people ask" title="Before you decide" />
        <div className="mx-auto max-w-3xl">
          <FaqAccordion items={faq} />
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-charcoal-ink/60">
          If you are managing hypertension or diabetes,{" "}
          <Link
            href={MARKETING_ROUTES.chronicCare}
            className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-4 hover:decoration-brand-green"
          >
            see how the chronic care programme works
          </Link>
          .
        </p>
      </Section>

      <Section>
        <div className="mx-auto max-w-4xl">
          <CtaBand
            variant="gradient"
            title="Start free, and join when you want a doctor to follow your readings"
            description="The app, your readings, your screening calendar and the education library are free and will stay free. Membership is available when you want your care team to follow your readings with you."
            primaryLabel="Create a free account"
            secondaryHref={MARKETING_ROUTES.pricing}
            secondaryLabel="See the two plans"
          />
        </div>
      </Section>
    </>
  );
}
