import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";


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
    when: "The moment you log it",
    body: "Your reading is checked against the protocol for your age, sex and conditions. This happens on every plan, including no plan at all, and always has.",
  },
  {
    when: "If it is dangerous",
    body: "You get clear guidance immediately, your emergency contact is notified, and we check in with you afterwards. None of that depends on paying us either.",
  },
  {
    when: "What Membership adds",
    body: "A doctor on your care team is told, and follows up with you personally. On the free plan, a worrying reading sits on your record until you or someone else looks.",
  },
  {
    when: "Between the alarms",
    body: "Trends get watched, not just single readings, and your screening calendar keeps moving alongside it.",
  },
];

const FAQ = [
  {
    question: "What happens to my readings on the free plan?",
    answer:
      "They are still checked against care protocols, every single one, and you still get the full emergency safety net: immediate guidance, your emergency contact notified, and a check-in afterwards. On the free plan a doctor is not told, and we say so plainly on the screen. Membership is what puts a doctor on your care team in the loop.",
  },
  {
    question: "Is this insurance?",
    answer:
      "No, and it does not replace it. An HMO pays your bills the day you are admitted. This watches your numbers in the years before that day, so it comes later or not at all.",
  },
  {
    question: "Does Membership renew automatically?",
    answer:
      "No. It lasts a year. We remind you 30, 14 and 7 days before it ends, and you keep your Member access for 14 days after. There is no card kept on file and nothing to cancel.",
  },
  {
    question: "What counts as a dangerous reading?",
    answer:
      "Blood pressure, blood sugar, oxygen, temperature and pulse each have thresholds set from clinical guidelines and signed off by our clinical director. They are the same on both plans.",
  },
  {
    question: "Do I need Membership for hypertension or diabetes?",
    answer:
      "You do not need it to use the app, and the self-monitoring track of the chronic programme is free. Membership is what gives you a doctor who reviews your readings and adjusts your plan.",
  },
];

export default function MonitoringPage() {
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          size="large"
          eyebrow="Continuous monitoring"
          title="Someone is told when it matters"
          description="Your readings are already checked against care protocols, whatever you pay. This is what puts a dangerous one in front of a doctor on your care team, instead of leaving it on your record for someone to find later."
        />

        <div className="mx-auto max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            Most of what goes wrong in hypertension and diabetes does not announce itself. It shows
            up as a number that is a little worse than last month, then a little worse again, in a
            record nobody is reading.
          </p>
          <p>
            The checking is the cheap part and we do it for everyone. Having a doctor who notices is
            the part that costs something, so that is the part we charge for.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What actually happens"
          title="Free either way, and the one thing that is not"
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
              Every reading checked, immediate guidance, your emergency contact told, and a check-in afterwards. No time limit and no card.
            </p>
          </div>
          <div className="rounded-2xl border border-brand-green/25 bg-white p-6 shadow-sm">
            <p className="font-heading text-lg font-semibold text-charcoal-ink">Membership</p>
            <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">
              Everything in Free, and a doctor on your care team is told about a dangerous reading and follows up with you. Your price is on the pricing page.
            </p>
          </div>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Questions people ask" title="Before you decide" />
        <div className="mx-auto max-w-3xl">
          <FaqAccordion items={FAQ} />
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-charcoal-ink/60">
          Managing hypertension or diabetes?{" "}
          <Link
            href={MARKETING_ROUTES.chronicCare}
            className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-4 hover:decoration-brand-green"
          >
            See how the chronic programme works
          </Link>
          .
        </p>
      </Section>

      <Section>
        <div className="mx-auto max-w-4xl">
          <CtaBand
            variant="gradient"
            title="Start free, join when you want a doctor watching with you"
            description="The app, your readings, your screening calendar and the education library cost nothing and always will. Membership is there when you want your care team watching the numbers with you."
            primaryLabel="Create a free account"
            secondaryHref={MARKETING_ROUTES.pricing}
            secondaryLabel="See the two plans"
          />
        </div>
      </Section>
    </>
  );
}
