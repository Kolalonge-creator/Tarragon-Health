import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { Section, SectionHeading } from "../_components/section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Vaccinations",
  description:
    "A personal vaccination schedule for you and your children, reminders when a dose is due, and a doctor-verified certificate you'll never lose. Get the dose wherever suits you, then log it.",
  path: MARKETING_ROUTES.vaccinations,
});

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Your schedule builds itself",
    body: "Your own due and upcoming vaccines are worked out automatically, from routine childhood immunisation through to adult and travel doses like HPV. Add a child too young to have their own login and their schedule lives on your account, tracked the same way.",
  },
  {
    step: 2,
    title: "A reminder when a dose is due",
    body: "No more guessing from memory or a paper card. You're reminded before a dose is due, and you get it done at whichever clinic or vaccination provider suits you.",
  },
  {
    step: 3,
    title: "Log the dose, upload the record",
    body: "After the visit, log the dose and attach a photo of the physical certificate or record given at the facility.",
  },
  {
    step: 4,
    title: "A doctor verifies it",
    body: "A Tarragon doctor checks the uploaded record and issues a verified Tarragon certificate with its own serial number: proof that holds up, not just a photo in your camera roll.",
  },
];

const WHATS_INCLUDED = [
  {
    title: "Your own record, and your children's",
    body: "A child too young to have their own login keeps their schedule on your account, in the same record as the rest of their care. An adult you're caring for, like a parent, keeps their own account; you follow their schedule as next of kin once they've agreed.",
  },
  {
    title: "Reminders, not memory",
    body: "You're prompted ahead of a due date, not left to remember a schedule from a paper card that can be lost, torn, or left behind on a trip.",
  },
  {
    title: "Get it done wherever suits you",
    body: "There's no facility to book through the app yet, so you take the dose at whichever clinic or provider is convenient and pay them directly; log it here afterwards.",
  },
  {
    title: "Doctor-verified certificate",
    body: "Every completed dose can be verified by a Tarragon doctor and issued as a certificate with a unique serial number, downloadable as a PDF whenever you need it.",
  },
  {
    title: "The next dose, scheduled automatically",
    body: "Multi-dose series roll forward on their own once a dose is verified: no manual re-entry, no missed follow-up shots.",
  },
  {
    title: "Free for everyone",
    body: "Vaccination tracking, reminders, and verification are free for every Tarragon member; this is prevention we think everyone should have.",
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
            A personal vaccination schedule for you and any children too young to have their own
            login, a reminder before a dose is due, and a doctor-verified certificate you&apos;ll
            never lose, even if the paper one is. Get the dose wherever suits you and pay them
            directly; we take nothing on it.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">Start your schedule</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href={MARKETING_ROUTES.prevention}>Explore preventive health</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-charcoal-ink/60">
            Already a member? Log a vaccination from your dashboard&apos;s Prevention section.
          </p>
        </div>
      </Section>

      <Section variant="sage">
        <div className="mx-auto mb-10 grid max-w-4xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="text-center lg:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              What&apos;s included
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Everything a paper card should have been
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Built for families in Nigeria, where a lost card usually means starting the record
              over from nothing.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "vaccine-record",
              imageAlt: "A doctor-verified vaccination certificate that can't be lost",
            }}
          />
        </div>
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
            For your children, and for whoever else you look after
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            A child too young to have their own login keeps their routine immunisation schedule on
            your account, tracked the same way as your own, including the doses that are easy to
            lose track of between school-age boosters and travel. If you&apos;re abroad, their
            schedule and verified certificates are visible to you from anywhere; the visit itself
            still happens wherever they are, in Nigeria.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            Caring for an adult relative, like a parent? They keep their own Tarragon account and
            their own vaccination schedule; you follow it as next of kin once they&apos;ve agreed,
            never by adding them to yours. See{" "}
            <Link href={MARKETING_ROUTES.parentcare} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              Caring for a parent
            </Link>{" "}
            for how that works. Vaccinations are one part of{" "}
            <Link href={MARKETING_ROUTES.prevention} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              preventive health at Tarragon
            </Link>
            , which also builds your free screening calendar and your yearly Health Check.
          </p>
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Give your vaccine record a permanent home."
          description="Free to start, verified when it matters."
          primaryHref="/signup"
          primaryLabel="Start your schedule"
        />
      </Section>
    </>
  );
}
