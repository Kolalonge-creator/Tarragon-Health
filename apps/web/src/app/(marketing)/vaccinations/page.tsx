import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "Vaccinations",
  description:
    "A personal vaccination schedule for you and your children, reminders when a dose is due, easy booking at a partner facility, and a doctor-verified certificate you'll never lose.",
  alternates: { canonical: MARKETING_ROUTES.vaccinations },
};

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Your schedule builds itself",
    body: "Add yourself and your children to your Tarragon family, and each person's due and upcoming vaccines are worked out automatically, from routine childhood immunisation through to adult and travel doses like HPV.",
  },
  {
    step: 2,
    title: "A reminder when a dose is due",
    body: "No more guessing from memory or a paper card. You're reminded before a dose is due, with a partner facility you can book straight from the app.",
  },
  {
    step: 3,
    title: "Log the dose, upload the record",
    body: "After the visit, log the dose and attach a photo of the physical certificate or record given at the facility.",
  },
  {
    step: 4,
    title: "A doctor verifies it",
    body: "A Tarragon doctor checks the uploaded record and issues a verified Tarragon certificate with its own serial number — proof that holds up, not just a photo in your camera roll.",
  },
];

const WHATS_INCLUDED = [
  {
    title: "One record per family member",
    body: "Every child and adult in your family has their own schedule, in the same record as the rest of their care — nothing to track separately.",
  },
  {
    title: "Reminders, not memory",
    body: "You're prompted ahead of a due date, not left to remember a schedule from a paper card that can be lost, torn, or left behind on a trip.",
  },
  {
    title: "Book at a partner facility",
    body: "Choose a facility near you and book the appointment directly, with the price shown up front.",
  },
  {
    title: "Doctor-verified certificate",
    body: "Every completed dose can be verified by a Tarragon doctor and issued as a certificate with a unique serial number, downloadable as a PDF whenever you need it.",
  },
  {
    title: "The next dose, scheduled automatically",
    body: "Multi-dose series roll forward on their own once a dose is verified — no manual re-entry, no missed follow-up shots.",
  },
  {
    title: "Available on every Tarragon plan",
    body: "Vaccination tracking, booking, and verification are available on every plan, including Free — this is prevention we think everyone should have.",
  },
];

export default function VaccinationsPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Never lose track again
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Vaccinations, tracked and verified
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            A personal vaccination schedule for you and your children, a reminder before a dose is
            due, easy booking at a partner facility near you, and a doctor-verified certificate
            you&apos;ll never lose — even if the paper one is.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">Start your family&apos;s schedule</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.prevention}>Explore preventive health</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            Already a member? Log or book a vaccination from your dashboard&apos;s Prevention
            section.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="What's included"
          title="Everything a paper card should have been"
          description="Built for families in Nigeria, where a lost card usually means starting the record over from nothing."
        />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {WHATS_INCLUDED.map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6"
            >
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="How it works" title="From due date to verified certificate" />
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.step} className="rounded-xl border border-charcoal-ink/10 bg-white p-6">
              <p className="font-heading text-2xl font-bold text-brand-green">{item.step}</p>
              <h3 className="mt-2 font-heading text-base font-semibold text-charcoal-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto max-w-3xl rounded-2xl border border-charcoal-ink/10 bg-white p-8">
          <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
            For the whole family, wherever you are
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Add your children to your Tarragon family and their routine immunisation schedule is
            tracked the same way as your own — including the doses that are easy to lose track of
            between school-age boosters and travel. If you&apos;re following your family&apos;s
            care from outside Nigeria, the schedule and verified certificates are visible to you
            from anywhere; booking and the visit itself happen at a partner facility in Nigeria.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Vaccinations are one part of{" "}
            <Link href={MARKETING_ROUTES.prevention} className="text-brand-green hover:underline">
              Tarragon Prevent
            </Link>
            , which also builds your screening calendar and yearly Health Check — or explore{" "}
            <Link href={MARKETING_ROUTES.parentcare} className="text-brand-green hover:underline">
              ParentCare
            </Link>{" "}
            for coordinated family monitoring.
          </p>
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Give your family's vaccine record a permanent home."
          description="Free to start, verified when it matters."
          primaryHref="/signup"
          primaryLabel="Start your family's schedule"
        />
      </Section>
    </>
  );
}
