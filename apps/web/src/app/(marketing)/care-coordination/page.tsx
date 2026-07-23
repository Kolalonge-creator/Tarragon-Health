import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { SERVICE_CARDS } from "../_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Care coordination",
  description:
    "TarragonHealth coordinates labs, medication, and specialist referrals: tests booked with trusted partner labs at a price you confirm first, refills through licensed partner pharmacies, and every result reviewed.",
  alternates: { canonical: MARKETING_ROUTES.careCoordination },
};

const COORDINATION_KEYS = ["medication", "labs"] as const;
const COORDINATION_CARDS = SERVICE_CARDS.filter((card) =>
  (COORDINATION_KEYS as readonly string[]).includes(card.key)
);

const CONNECTS = [
  {
    title: "Hassle-free lab tests",
    body: "No more guessing which lab to trust or queuing to ask for prices. Tarragon tells you which tests are due, shows you the exact price up front, books you into a vetted partner lab, and makes sure a doctor reviews every result — never a report that sits unread.",
  },
  {
    title: "Genuine medication, refilled on time",
    body: "Refills are coordinated through licensed, vetted partner pharmacies, so you know the medication you collect is genuine, not counterfeit. Refill alerts arrive before you run out, and your doctor follows up if doses are being missed.",
  },
  {
    title: "Specialist referrals that carry your record",
    body: "When your care team refers you to a specialist, the referral travels with your health record — your readings, medications, and results — not a paper slip that gets lost. Afterwards, follow-up comes back onto the same record.",
  },
];

const JOURNEY = [
  {
    title: "We tell you what's needed",
    body: "A test is due, a refill is running low, or your doctor recommends a check. You see it in the app, with a reminder so it doesn't slip.",
  },
  {
    title: "You see the exact price and confirm",
    body: "Before anything is booked, you see the real partner price and confirm. Nothing is ever charged without your confirmation.",
  },
  {
    title: "We book it with a trusted partner",
    body: "Tarragon books the lab, pharmacy, or specialist from its vetted partner network and sends you exactly where to go, what to bring, and how to prepare.",
  },
  {
    title: "The result comes back reviewed",
    body: "Your result lands on your record, explained in plain language, and a doctor reviews it. If anything needs attention, your care team follows up directly, at no extra charge.",
  },
];

export default function CareCoordinationPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="Care coordination"
          title="The pieces of your care, kept connected"
          description="In most of Nigeria, you are your own care coordinator: finding a reliable lab, chasing results, hunting for genuine medication, carrying paper records between hospitals. Tarragon takes that job off you — one care team coordinating labs, pharmacies, and specialists from one shared record."
        />
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2">
          {COORDINATION_CARDS.map((service) => (
            <ServiceCardLink key={service.key} service={service} />
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What we connect"
          title="One record, less chasing"
          description="Coordination isn't an abstract promise. Here is exactly what it does for you."
        />
        <div className="grid gap-6 md:grid-cols-3">
          {CONNECTS.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6 transition duration-200 hover:-translate-y-0.5 hover:border-brand-green/30 hover:shadow-md"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-soft-sage text-deep-forest"
                aria-hidden
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <h3 className="mt-4 font-heading text-xl font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-3 text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="How a coordinated booking works"
          title="From “it's due” to “it's done”, in four steps"
        />
        <ol className="mx-auto grid max-w-3xl gap-6">
          {JOURNEY.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-semibold text-white"
                aria-hidden
              >
                {index + 1}
              </span>
              <div>
                <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{step.title}</h3>
                <p className="mt-1 text-charcoal-ink/70">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Typical partner-lab prices are published openly on our{" "}
          <Link href={MARKETING_ROUTES.pricing} className="font-medium text-deep-forest hover:underline">
            pricing page
          </Link>
          , so you can budget before you ever book.
        </p>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Why it matters"
          title="Care falls apart in the gaps between providers"
        />
        <div className="mx-auto max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            A blood pressure reading at one clinic, a lab result from another, medication bought
            wherever it was available that day — when no one holds the full picture, warning signs
            get missed and money gets wasted repeating tests.
          </p>
          <p>
            Tarragon holds the full picture. Every reading, result, refill, and referral lives on
            one longitudinal record that your care team actually watches, so an abnormal result
            triggers follow-up within hours, a refill is arranged before you run out, and a
            specialist sees your history instead of starting from zero.
          </p>
        </div>
      </Section>

      <Section className="pb-24">
        <CtaBand
          title="Keep your care coordinated"
          description="Labs, medication, and referrals working from one record."
          primaryHref="/signup"
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
