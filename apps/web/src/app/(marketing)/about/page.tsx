import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { User } from "lucide-react";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { TrustPillars } from "../_components/trust-pillars";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

function LinkedInGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.59 0 4.25 2.36 4.25 5.44v6.3zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  );
}

/**
 * Key seats TarragonHealth needs beyond the founder as it scales past one
 * doctor, mapped to the five business categories in CLAUDE.md (chronic
 * disease + prevention, care coordination, B2B & institutional, platform
 * infrastructure, clinical delivery). All open, no names yet.
 */
const OPEN_ROLES: { title: string; scope: string }[] = [
  {
    title: "Chief Medical Officer",
    scope: "Owns clinical protocols and the four-level escalation pathway, and leads the doctor network as chronic disease and preventive screening scale together.",
  },
  {
    title: "Head of Clinical Operations",
    scope: "Builds and leads the clinical review model: recruiting, training, and scheduling the doctors who keep the doctor:patient ratio at 1:120.",
  },
  {
    title: "Head of Engineering",
    scope: "Owns the TypeScript platform and ML microservice, the system of record behind every reading, reminder, and escalation.",
  },
  {
    title: "Head of Partnerships",
    scope: "Grows and manages the lab, pharmacy, and specialist network that Care Coordination runs on.",
  },
  {
    title: "Head of Growth & Commercial",
    scope: "Leads corporate wellness and HMO capitation partnerships, turning the B2B & Institutional pipeline into revenue.",
  },
];

export const metadata: Metadata = {
  title: "About",
  description:
    "Why TarragonHealth exists: continuity of care between doctor visits, for Nigerians and the people who love them.",
  alternates: { canonical: MARKETING_ROUTES.about },
};

export default function AboutPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="About"
          title="Built for the care that happens between visits"
          description="Chronic disease isn't managed in the clinic. It's managed in the days after, in the missed dose, the reading nobody saw, and the follow-up call that never came. TarragonHealth exists to close that gap."
        />
      </Section>

      <Section variant="sage">
        <SectionHeading eyebrow="Founder" title="Built and led by a practising doctor" />
        <div className="mx-auto max-w-xl">
          <div className="flex flex-col items-center rounded-2xl border border-charcoal-ink/10 bg-white p-8 text-center sm:p-10">
            <div className="h-32 w-32 overflow-hidden rounded-full border-4 border-white shadow-lg ring-2 ring-brand-green/30 sm:h-36 sm:w-36">
              <Image
                src="/marketing/founder-kola-longe.jpg"
                alt="Dr Kola Longe, Founder & CEO of TarragonHealth"
                width={288}
                height={288}
                className="h-full w-full object-cover"
                priority
              />
            </div>
            <span className="mt-4 inline-flex rounded-full bg-brand-green/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-deep-forest">
              Founder &amp; CEO
            </span>
            <h3 className="mt-3 font-heading text-2xl font-semibold text-charcoal-ink">
              Dr Kola Longe
            </h3>
            <p className="mt-1 text-sm font-medium text-charcoal-ink/60">
              Emergency Physician &amp; Health Innovator
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-charcoal-ink/40">
              MBChB · FEBEM · FRCEM · MSt (University of Cambridge)
            </p>
            <p className="mt-4 leading-relaxed text-charcoal-ink/70">
              Over a decade in frontline emergency medicine across Nigeria and
              the UK, paired with PMP and PgMP certification from the Project
              Management Institute. Kola founded TarragonHealth to bring that
              same rigour to the gap between doctor visits, leading clinical
              strategy and product direction so every patient&rsquo;s care
              stays protocol-driven, continuous, and never left to chance.
            </p>
            <a
              href="https://www.linkedin.com/in/dr-kola-longe-408b15121/"
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#0A66C2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-105 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A66C2] focus-visible:ring-offset-2"
            >
              <LinkedInGlyph className="h-4 w-4" />
              Connect on LinkedIn
            </a>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="The thesis"
          title="Continuity, not just monitoring"
          description="Prevention and chronic disease management share the same patient record at TarragonHealth. The same family, the same phone, and the same doctor follow a person from a routine screening through an ongoing condition, and the story never resets."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            {
              title: "Clinically reviewed",
              body: "Every reading and result is reviewed by your clinical team, never an algorithm acting alone.",
            },
            {
              title: "Protocol-driven",
              body: "Escalation follows a defined four-level pathway, every time, for every patient.",
            },
            {
              title: "Family included, if you choose",
              body: "On ParentCare, the people looking after a parent can opt in to updates, so they stay informed rather than left guessing. It is a choice, not a default.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-charcoal-ink/10 bg-white p-6 text-center"
            >
              <h3 className="font-heading text-lg font-semibold text-charcoal-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section variant="navy">
        <SectionHeading
          invert
          eyebrow="What we stand for"
          title="How we work, and what we won't do"
          description="Tarragon is built for the care between doctor visits: protocol-driven, evidence-focused, and consistent. These are the commitments behind that."
        />
        <TrustPillars />
      </Section>

      <Section variant="sage">
        <SectionHeading
          eyebrow="Team"
          title="Roles we're building out next"
          description="TarragonHealth is growing beyond one founder. These seats are open, no names yet, so say hello if one of them is you."
        />
        <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {OPEN_ROLES.map((role) => (
            <div
              key={role.title}
              className="flex flex-col items-center rounded-2xl border border-charcoal-ink/10 bg-white p-6 text-center"
            >
              <div
                className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-charcoal-ink/20 text-charcoal-ink/40"
                role="img"
                aria-label={`Placeholder for ${role.title}`}
              >
                <User className="h-7 w-7" strokeWidth={1.25} />
              </div>
              <span className="mt-3 inline-flex rounded-full bg-brand-green/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-deep-forest">
                Open role
              </span>
              <h3 className="mt-3 font-heading text-lg font-semibold text-charcoal-ink">
                {role.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{role.scope}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Think you&rsquo;re a fit for one of these?{" "}
          <Link
            href={`${MARKETING_ROUTES.contact}?source=careers`}
            className="font-medium text-deep-forest hover:underline"
          >
            Get in touch
          </Link>
          .
        </p>
      </Section>

      <Section>
        <CtaBand
          variant="gradient"
          title="Come build continuity of care with us"
          description="Whether you're a patient, a family member, an employer, or an HMO, we'd like to hear from you."
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.contact + "?source=about"}
          secondaryLabel="Get in touch"
        />
        <p className="mt-6 text-center text-sm text-charcoal-ink/70">
          Read more about what we do on the{" "}
          <Link href={MARKETING_ROUTES.pricing} className="font-medium text-deep-forest hover:underline">
            Pricing
          </Link>{" "}
          page.
        </p>
      </Section>
    </>
  );
}
