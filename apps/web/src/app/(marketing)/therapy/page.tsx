import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { FaqAccordion } from "../_components/marketing-faq-accordion";
import { MentalHealthSupportNotice } from "../_components/mental-health-support-notice";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const revalidate = 300;

/**
 * The verified therapy network.
 *
 * THREE THINGS THIS PAGE HAS TO GET RIGHT, IN THIS ORDER.
 *
 * 1. Someone in crisis must not be funnelled towards a booking. A therapy
 *    appointment in a fortnight is not the answer to suicidal ideation, and a
 *    page that reads like it is does harm. The crisis notice comes first, and
 *    the platform enforces the same rule -- a patient with an open crisis alert
 *    is refused a booking by the database, not merely discouraged by copy.
 *
 * 2. These practitioners do not work for Tarragon and the page must never
 *    imply they do. They are psychologists and psychiatrists in private
 *    practice whose registration Tarragon has verified; Tarragon takes the
 *    booking and earns a commission. Someone deciding where to take something
 *    this personal is entitled to know which relationship they are in.
 *
 * 3. No ranking, no "best match", no "recommended for you". This platform has a
 *    standing guardrail against a specialist matching engine. Listing verified
 *    practitioners and letting somebody filter is not that; scoring them, or
 *    ordering by anything Tarragon earns, would be. The directory is sorted
 *    alphabetically and this page must not promise otherwise.
 */

export const metadata: Metadata = pageMetadata({
  title: "Talk to someone",
  description:
    "Psychologists and psychiatrists in private practice whose registration we have checked. Book through the app and see the fee before you commit.",
  path: MARKETING_ROUTES.therapy,
});

const WHAT_WE_CHECK = [
  {
    title: "Their registration, and that it is still in date",
    body: "Nobody appears in the directory without a verified licence, and anyone whose registration lapses disappears from it automatically rather than waiting for someone to notice.",
  },
  {
    title: "That they actually offer what they are listed for",
    body: "Whether they see people online, in person, or both, and in which languages. If someone only sees people in person, you will not be able to book a video session with them by mistake.",
  },
  {
    title: "What they charge, before you commit",
    body: "The fee is shown on the listing and fixed at the moment you request the session, so a practitioner changing their rate afterwards cannot change what you were quoted.",
  },
];

const FAQ = [
  {
    question: "Do these therapists work for Tarragon?",
    answer:
      "No. They are in private practice. We verify their registration, list them, take the booking and keep it on your record, and we earn a commission on it. Your care team at Tarragon is a separate thing, and we would rather you knew which is which.",
  },
  {
    question: "Do I need a referral?",
    answer:
      "Not for a psychologist. Booking counselling yourself is ordinary and safe, and you can do it straight from the app. Psychiatry is different: it involves diagnosis and medication, so a doctor on your care team reviews the request first. That usually takes a day or so and they will explain their thinking either way.",
  },
  {
    question: "Will my care team see that I am doing this?",
    answer:
      "Clinical staff at Tarragon can see the booking, because it is part of your record and safe care depends on your doctors knowing what else is going on. A family member or carer who can see the rest of your record cannot: we deliberately did not put therapy behind the same permission as the medication list.",
  },
  {
    question: "How do you decide which practitioner to show me first?",
    answer:
      "Alphabetically. We do not rank them, we do not have a 'best match' and nothing is ordered by what we earn. You filter by what you need and choose for yourself.",
  },
  {
    question: "What if I need help right now?",
    answer:
      "Do not wait for an appointment. If you are thinking about harming yourself, use the emergency guidance in the app or go to the nearest hospital. If you have already told us in a wellbeing check-in, we will have raised it and someone will be in contact; booking a session for a fortnight's time is not the right response to that and the app will not let you.",
  },
];

export default function TherapyPage() {
  return (
    <>
      <Section>
        <SectionHeading
          as="h1"
          size="large"
          eyebrow="Talk to someone"
          title="Verified therapists, booked in the same place as the rest of your care"
          description="Psychologists and psychiatrists in private practice whose registration we have checked. You see the fee before you commit, and the session sits on the same record as everything else."
        />

        {/* First, deliberately. Anyone arriving here in real distress needs the
            urgent route before the commercial one. */}
        <div className="mx-auto max-w-3xl">
          <MentalHealthSupportNotice />
        </div>

        <div className="mx-auto mt-10 max-w-3xl space-y-4 text-lg leading-relaxed text-charcoal-ink/75">
          <p>
            Finding a therapist in Nigeria mostly means asking around and hoping. There is no easy
            way to check that someone is registered, no fee until you have already made contact, and
            nothing connecting the session to the rest of your health.
          </p>
          <p>
            We screen for depression, anxiety and hazardous drinking already. It was a poor state of
            affairs to find something and then have nothing to offer.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="What being on the list means" title="What we check, and what we do not" />
        <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-3">
          {WHAT_WE_CHECK.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6 shadow-sm"
            >
              <h3 className="font-heading text-base font-semibold text-charcoal-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">{item.body}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-charcoal-ink/65">
          What we do not do is rank them. There is no score, no best match and nothing ordered by
          what we earn. You filter by what you need and choose for yourself.
        </p>
      </Section>

      <Section>
        <SectionHeading eyebrow="Questions people ask" title="Before you book" />
        <div className="mx-auto max-w-3xl">
          <FaqAccordion items={FAQ} />
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-charcoal-ink/60">
          Not sure where you are?{" "}
          <Link
            href={MARKETING_ROUTES.mentalWellbeingCheck}
            className="font-medium text-brand-green underline decoration-brand-green/40 underline-offset-4 hover:decoration-brand-green"
          >
            The wellbeing check is free and takes a few minutes
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage">
        <div className="mx-auto max-w-4xl">
          <CtaBand
            variant="gradient"
            title="Start with the free check, book when you are ready"
            description="The wellbeing check, the education library and the AI Health Coach cost nothing. The directory is there when you want to speak to a person."
            primaryLabel="Create a free account"
            secondaryHref={MARKETING_ROUTES.mentalWellbeingCheck}
            secondaryLabel="Take the wellbeing check"
          />
        </div>
      </Section>
    </>
  );
}
