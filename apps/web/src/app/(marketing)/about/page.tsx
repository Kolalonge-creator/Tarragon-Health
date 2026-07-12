import type { Metadata } from "next";
import Link from "next/link";
import { User } from "lucide-react";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

export const metadata: Metadata = {
  title: "About — TarragonHealth",
  description:
    "Why TarragonHealth exists: clinician-led continuity of care between doctor visits, for Nigerian families and the people who love them.",
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
        {/*
          Placeholder — replace with the real founder name, photo, and bio
          before this page ships publicly. See docs/MARKETING_SITE_SPEC.md §3.4.
        */}
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-brand-green">
              Founder
            </p>
            <h2 className="mt-2 font-heading text-3xl font-semibold text-charcoal-ink sm:text-4xl">
              [Founder Name]
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/70">
              [One or two sentences on the founder&rsquo;s clinical or
              health-system background — replace with the real bio.]
            </p>
            <p className="mt-4 leading-relaxed text-charcoal-ink/70">
              [Add the founder&rsquo;s story here — what they saw in practice, in
              their own family, or in the Nigerian health system that led to
              building TarragonHealth, and why continuity between visits became
              the founding thesis.]
            </p>
          </div>
          <div
            className="flex aspect-4/3 flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-charcoal-ink/20 bg-white text-charcoal-ink/40"
            role="img"
            aria-label="Placeholder for founder photo"
          >
            <User className="h-16 w-16" strokeWidth={1.25} />
            <span className="text-sm font-medium uppercase tracking-wide">
              Founder photo goes here
            </span>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="The thesis"
          title="Continuity, not just monitoring"
          description="Prevention and chronic disease management share the same patient record at TarragonHealth. The same family, the same phone, and the same nurse follow a person from a routine screening through an ongoing condition — the story never resets."
        />
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            {
              title: "Clinician-led",
              body: "A real clinician reviews readings and results — never an algorithm acting alone.",
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
        <CtaBand
          variant="gradient"
          title="Come build continuity of care with us"
          description="Whether you're a patient, a family member, an employer, or an HMO — we'd like to hear from you."
          primaryLabel="Start monitoring"
          secondaryHref={MARKETING_ROUTES.contact + "?source=about"}
          secondaryLabel="Get in touch"
        />
        <p className="mt-6 text-center text-sm text-charcoal-ink/60">
          Read more about what we do on the{" "}
          <Link href={MARKETING_ROUTES.pricing} className="font-medium text-brand-green hover:underline">
            Pricing
          </Link>{" "}
          page.
        </p>
      </Section>
    </>
  );
}
