import type { Metadata } from "next";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { Section, SectionHeading } from "../_components/section";
import { ServiceCardLink } from "../_components/service-card";
import { SERVICE_CARDS } from "../_content/services";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Care coordination",
  description:
    "TarragonHealth works out which tests you need and when, writes you a request to take to any laboratory you like, reads every result that comes back, and follows up. You pay the lab directly and we take nothing on it.",
  path: MARKETING_ROUTES.careCoordination,
});

const COORDINATION_KEYS = ["medication", "labs"] as const;
const COORDINATION_CARDS = SERVICE_CARDS.filter((card) =>
  (COORDINATION_KEYS as readonly string[]).includes(card.key)
);

const CONNECTS = [
  {
    title: "Hassle-free lab tests",
    body: "No more guessing what you should be checking or when. Tarragon works out which tests are due for you, writes the request to take to whichever laboratory suits you, and makes sure a doctor reads every result: never a report that sits unread.",
  },
  {
    title: "Refills tracked, wherever you buy",
    body: "You buy your medication at whichever pharmacy suits you and pay them directly. Refill alerts arrive before you run out, you log what you collected, and your doctor follows up if doses are being missed.",
  },
  {
    title: "Specialist referrals that carry your record",
    body: "When your care team refers you to a specialist, you get a proper referral letter carrying your readings, medications, and the result that prompted it, so the specialist knows why you are there instead of asking you to explain. You choose which specialist to see and pay them directly. Bring their findings back and they go onto the same record.",
  },
  {
    title: "A doctor, when you need one directly",
    body: "Send a written question and get a doctor's reply within 72 hours via the app, included on Complete Care, or book a 15-minute online consultation with a doctor on any plan. Your payment is only taken once a doctor accepts your slot, and refunded in full if none can.",
  },
];

const JOURNEY = [
  {
    title: "We tell you what's needed",
    body: "A test is due, a refill is running low, or your doctor recommends a check. You see it in the app, with a reminder so it doesn't slip.",
  },
  {
    title: "You choose where to go",
    body: "We write the request and you take it to whichever laboratory you trust. You pay them directly, at their price, and we take nothing on it.",
  },
  {
    title: "You get a request to take with you",
    body: "A written request naming exactly which tests to run and why, so the laboratory knows what to do and nothing is left to a conversation at the counter.",
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
          as="h1"
          eyebrow="Care coordination"
          title="The pieces of your care, kept connected"
          description="In most of Nigeria, you are your own care coordinator: finding a reliable lab, chasing results, hunting for genuine medication, carrying paper records between hospitals. Tarragon takes that job off you: one care team coordinating labs, pharmacies, and specialists from one shared record."
        />
        <div className="mx-auto grid max-w-3xl gap-6 sm:grid-cols-2">
          {COORDINATION_CARDS.map((service) => (
            <ServiceCardLink key={service.key} service={service} />
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              One care team, everywhere you already go
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Labs, pharmacies, and specialists, coordinated from one record
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Tarragon doesn&apos;t own a lab, a pharmacy, or a specialist practice. It coordinates the
              ones you already use, wherever you like, so nothing you need falls through the gap
              between providers.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "care-network",
              imageAlt: "Your care team coordinating between a lab, a pharmacy, and a specialist",
            }}
          />
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="What we connect"
          title="One record, less chasing"
          description="Coordination isn't an abstract promise. Here is exactly what it does for you."
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
          We do not set, quote, or collect a naira for any test. The laboratory tells you its own
          price when you get there, and you pay them directly, so there is never a Tarragon price
          to guess at beforehand.
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
            wherever it was available that day: when no one holds the full picture, warning signs
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
          primaryLabel="Get started"
          secondaryHref={MARKETING_ROUTES.pricing}
          secondaryLabel="View pricing"
        />
      </Section>
    </>
  );
}
