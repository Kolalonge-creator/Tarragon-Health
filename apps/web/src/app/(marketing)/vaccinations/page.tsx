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
    "A personal vaccination schedule for you and your children, a reminder when a dose is due, and a doctor-verified certificate. Get the dose anywhere.",
  path: MARKETING_ROUTES.vaccinations,
});

const HOW_IT_WORKS = [
  {
    step: 1,
    title: "Your schedule is created for you",
    body: "The vaccines that are due or coming up for you are worked out automatically, from routine childhood immunisation to adult and travel vaccines such as human papillomavirus (HPV). If you add a child who is too young to have their own login, their schedule is kept on your account in the same way.",
  },
  {
    step: 2,
    title: "A reminder when a dose is due",
    body: "A reminder arrives before each dose is due, so you do not have to rely on memory or a paper card. You can have the dose at whichever clinic suits you.",
  },
  {
    step: 3,
    title: "Record the dose and upload the proof",
    body: "After the visit, record the dose and attach a photo of the certificate or record that the facility gave you.",
  },
  {
    step: 4,
    title: "A doctor verifies it",
    body: "A Tarragon doctor checks the uploaded record and issues a verified Tarragon certificate with its own serial number. This is reliable proof, rather than only a photo on your phone.",
  },
];

const WHATS_INCLUDED = [
  {
    title: "Your own record, and your children's",
    body: "A child too young to have their own login keeps their schedule on your account. A parent or other adult you support keeps their own account, which you can follow as next of kin once they have agreed.",
  },
  {
    title: "Reminders instead of memory",
    body: "You are reminded ahead of each due date, so you do not need to remember a schedule from a paper card that can be lost, torn or left behind on a trip.",
  },
  {
    title: "Have the dose wherever suits you",
    body: "Booking is not yet available in the app. Have the dose at whichever clinic suits you, pay the clinic directly, and record it here afterwards.",
  },
  {
    title: "Doctor-verified certificate",
    body: "Every completed dose can be verified by a Tarragon doctor and issued as a certificate with a unique serial number, downloadable as a PDF whenever you need it.",
  },
  {
    title: "The next dose, scheduled automatically",
    body: "For vaccines given in several doses, the next dose is scheduled automatically once a dose is verified, so you do not need to enter it again or miss a follow-up dose.",
  },
  {
    title: "Free for everyone",
    body: "Vaccination tracking, reminders and verification are free for every Tarragon member, because we believe everyone should have access to this kind of prevention.",
  },
];

export default function VaccinationsPage() {
  return (
    <>
      <Section className="pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            Keep a lasting record
          </p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-tight text-charcoal-ink sm:text-5xl">
            Vaccinations, tracked and verified
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/70">
            A personal vaccination schedule, a reminder before each dose is due, and a
            doctor-verified certificate that stays safe even if the paper one is lost. Have the
            dose wherever suits you and pay the provider directly. We take no commission.
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
            If you are already a member, record a vaccination from the Prevention section of your dashboard.
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
              Everything a paper card cannot offer
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              This is designed for families in Nigeria, where a lost card often means the record has to
              be started again from nothing.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              illustration: "vaccine-record",
              imageAlt: "A doctor-verified vaccination certificate that cannot be lost",
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
            lose track of, such as school-age boosters and travel vaccines. If you are abroad, you can
            see their schedule and verified certificates from anywhere. The vaccination visit itself
            still takes place wherever they are, in Nigeria.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-charcoal-ink/70">
            If you care for an adult relative, such as a parent, they keep their own Tarragon account and
            their own vaccination schedule. You follow it as next of kin once they have agreed,
            rather than by adding them to your account. See{" "}
            <Link href={MARKETING_ROUTES.parentcare} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              Caring for a parent
            </Link>{" "}
            for how this works. Vaccinations are one part of{" "}
            <Link href={MARKETING_ROUTES.prevention} className="text-brand-green underline decoration-brand-green/40 underline-offset-2 hover:decoration-brand-green">
              preventive health at Tarragon
            </Link>
            , which also provides your free screening calendar and your yearly Health Check.
          </p>
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Keep your vaccination record in one safe place"
          description="Free to start, and verified by a doctor when you need proof."
          primaryHref="/signup"
          primaryLabel="Start your schedule"
        />
      </Section>
    </>
  );
}
