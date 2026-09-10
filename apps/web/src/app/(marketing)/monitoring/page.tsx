import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { PAID_SERVICES } from "../_content/pricing";
import { fetchPlanPrices } from "@/lib/marketing/plan-prices";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { fromMinorUnits } from "@tarragon/shared";

export const revalidate = 300;

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
 * ON "NOTHING RENEWS". The pricing page promises no subscription, no stored
 * card, nothing to cancel. This product is the one most likely to tempt someone
 * into adding auto-renewal later, because a lapse in cover looks like churn.
 * It is not churn, it is the promise working. If renewal is ever added it is a
 * founder decision about a public commitment, not a growth experiment.
 */

// Resolved by id with a hard failure rather than a non-null assertion, so a
// rename breaks the build here instead of rendering an empty price table.
const MONITORING = (() => {
  const found = PAID_SERVICES.find((service) => service.id === "continuous-monitoring");
  if (!found) {
    throw new Error(
      "monitoring: no PAID_SERVICES entry with id 'continuous-monitoring'. Update this page if the product is renamed."
    );
  }
  return found;
})();

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
    when: "What monitoring adds",
    body: "A doctor on your care team is told, and follows up with you personally. Without it, a worrying reading sits on your record until someone happens to look.",
  },
  {
    when: "Between the alarms",
    body: "Trends get watched, not just single readings, and your screening calendar keeps moving. The twelve-month term also carries your annual review.",
  },
];

const FAQ = [
  {
    question: "What happens to my readings if I do not buy this?",
    answer:
      "They are still checked against care protocols, every single one, and you still get the full emergency safety net: immediate guidance, your emergency contact notified, and a check-in afterwards. That has never depended on payment. What you do not get is a doctor being told and following up personally.",
  },
  {
    question: "Is this insurance?",
    answer:
      "No, and it does not replace it. An HMO pays your bills the day you are admitted. This watches your numbers in the years before that day, so it comes later or not at all. Most people who buy this keep their HMO, and it costs a fraction of one.",
  },
  {
    question: "Does it renew automatically?",
    answer:
      "No. You pay once for the term you choose and it stops at the end. There is no card kept on file and nothing to cancel. We tell you before it runs out so it is never a surprise.",
  },
  {
    question: "What counts as a dangerous reading?",
    answer:
      "Blood pressure, blood sugar, oxygen, temperature and pulse each have thresholds set from clinical guidelines and signed off by our clinical director. They are not adjusted for what you paid.",
  },
  {
    question: "Do I need it for hypertension or diabetes?",
    answer:
      "You do not need it to use the app, and the self-monitoring track of the chronic programme is free. Monitoring is what carries entry to the doctor-supported track, where a doctor reviews your readings and adjusts your plan alongside the reviews you buy as they fall due.",
  },
];

export default async function MonitoringPage() {
  const prices = await fetchPlanPrices();
  const priceFor = (code: string, fallback: string) => {
    const kobo = prices.get(code);
    return kobo === undefined
      ? fallback
      : `₦${fromMinorUnits(kobo, "NGN").toLocaleString("en-NG")}`;
  };

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
          eyebrow="What it costs"
          title="Paid once, for the term you choose"
          description="Longer terms cost less per month, because what a watch costs is the exceptions it raises, and those do not scale with how long it runs."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {(MONITORING.terms ?? []).map((term) => (
            <div
              key={term.code}
              className="flex flex-col rounded-2xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
            >
              <p className="text-sm font-medium uppercase tracking-wide text-charcoal-ink/55">
                {term.label}
              </p>
              <p className="mt-1 font-heading text-3xl font-bold text-brand-green">
                {priceFor(term.code, term.price)}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{term.perMonth}</p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-8 max-w-3xl rounded-2xl bg-soft-sage px-6 py-5">
          <p className="text-base leading-relaxed text-charcoal-ink/80">
            For comparison, the cheapest individual health insurance in Nigeria runs from about
            ₦42,000 a year and pays your hospital bills. A year of monitoring is well under half
            that and does something different: it watches your numbers so that the day you need the
            insurance comes later, or not at all. Most people who buy this keep their HMO.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Questions people ask" title="Before you buy" />
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
            title="Start free, add the watch when you want it"
            description="The app, your readings, your screening calendar and the education library cost nothing and always will. Monitoring is there when you want a doctor behind the numbers."
            primaryLabel="Create a free account"
            secondaryHref={MARKETING_ROUTES.pricing}
            secondaryLabel="See all prices"
          />
        </div>
      </Section>
    </>
  );
}
