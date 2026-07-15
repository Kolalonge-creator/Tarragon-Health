import type { Metadata } from "next";
import Link from "next/link";
import { User } from "lucide-react";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { MarketingMediaFrame } from "../_components/marketing-media-frame";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * Key seats TarragonHealth needs beyond the founder as it scales past one
 * clinician — mapped to the five business categories in CLAUDE.md (chronic
 * disease + prevention, care coordination, B2B & institutional, platform
 * infrastructure, clinician-led delivery). All open — no names yet.
 */
const OPEN_ROLES: { title: string; scope: string }[] = [
  {
    title: "Chief Medical Officer",
    scope: "Owns clinical protocols and the four-level escalation pathway, and leads the doctor network as chronic disease and preventive screening scale together.",
  },
  {
    title: "Head of Clinical Operations",
    scope: "Builds and leads the clinician-led review model — recruiting, training, and scheduling the clinicians who keep the clinician:patient ratio at 1:120.",
  },
  {
    title: "Head of Engineering",
    scope: "Owns the TypeScript platform and ML microservice — the system of record behind every reading, reminder, and escalation.",
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
  title: "About — TarragonHealth",
  description:
    "Why TarragonHealth exists: doctor-led continuity of care between doctor visits, for Nigerian families and the people who love them.",
};

export default function AboutPage() {
  return (
    <>
      <Section className="pt-20">
        <SectionHeading
          eyebrow="About"
          title="Built for the care that happens between visits"
          description="Chronic disease isn't managed in the clinic — it's managed in the days after, in the missed dose, the reading nobody saw, and the follow-up call that never came. TarragonHealth exists to close that gap."
        />
      </Section>

      <Section variant="sage">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              Founder
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              Dr Kola Longe
            </h2>
            <p className="mt-1 text-sm text-charcoal-ink/70">
              Founder &amp; CEO ·{" "}
              <a
                href="https://www.linkedin.com/in/dr-kola-longe-408b15121/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-deep-forest hover:underline"
              >
                LinkedIn
              </a>
            </p>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              Kola is an Emergency Medicine physician (FRCEM, FEBEM) and health
              systems leader who trained in Nigeria before practising in the
              UK, where he now works as a Specialty Doctor in Emergency
              Medicine, sits on the Regional Board of the Royal College of
              Emergency Medicine, and is completing postgraduate study in
              clinical medicine and healthcare leadership at the University of
              Cambridge and Alliance Manchester Business School.
            </p>
            <p className="mt-4 leading-relaxed text-charcoal-ink/70">
              Working across both systems, he kept seeing the same pattern:
              the difference between a good outcome and a bad one was rarely
              the diagnosis — it was whether the system around the patient
              responded in time. A condition caught and followed up within
              days looks nothing like the same condition missed for months.
              TarragonHealth grew out of that observation, applied to chronic
              disease and preventive care in Nigeria: most complications
              aren&rsquo;t a failure of medicine, they&rsquo;re a failure of
              follow-up. Kola founded TarragonHealth to build the system that
              closes that gap — doctor-led, protocol-driven, and never
              losing track of a patient between visits.
            </p>
          </div>
          <MarketingMediaFrame
            media={{
              imageSrc: "/marketing/founder-kola-longe.jpg",
              imageAlt: "Dr Kola Longe, Founder & CEO of TarragonHealth",
            }}
          />
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="The thesis"
          title="Continuity, not just monitoring"
          description="Prevention and chronic disease management share the same patient record at TarragonHealth. The same family, the same phone, and the same doctor follow a person from a routine screening through an ongoing condition — the story never resets."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            {
              title: "Doctor-led",
              body: "A real doctor reviews readings and results — never an algorithm acting alone.",
            },
            {
              title: "Protocol-driven",
              body: "Escalation follows a defined four-level pathway, every time, for every patient.",
            },
            {
              title: "Family included",
              body: "The people looking after a parent or partner stay informed, not left guessing.",
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

      <Section variant="sage">
        <SectionHeading
          eyebrow="Team"
          title="Roles we're building out next"
          description="TarragonHealth is growing beyond one founder. These seats are open — no names yet — say hello if one of them is you."
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
          description="Whether you're a patient, a family member, an employer, or an HMO — we'd like to hear from you."
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
