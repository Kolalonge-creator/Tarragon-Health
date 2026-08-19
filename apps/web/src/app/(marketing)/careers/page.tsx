import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { OPEN_ROLES } from "@/lib/marketing/open-roles";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Careers",
  description:
    "TarragonHealth is growing past one founder. See the seats we're currently hiring for.",
  path: MARKETING_ROUTES.careers,
});

export default function CareersPage() {
  return (
    <>
      <Section className="pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">Careers</p>
          <h1 className="mt-4 font-heading text-4xl font-bold leading-[1.05] text-charcoal-ink sm:text-5xl">
            Help us build the care between visits.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-charcoal-ink/75">
            TarragonHealth is growing past one founder. These are the seats we&rsquo;re currently
            hiring for, each one owning a real, load-bearing part of the platform from day one.
          </p>
        </div>
      </Section>

      <Section id="roles" variant="sage">
        <SectionHeading
          eyebrow="Open roles"
          title="Current openings"
          description="No one's in these seats yet. If one of them sounds like you, we'd like to hear from you."
        />
        <div className="mx-auto grid max-w-4xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {OPEN_ROLES.map((role) => (
            <div
              key={role.id}
              className="flex flex-col rounded-2xl border border-charcoal-ink/10 bg-white p-6"
            >
              <span className="inline-flex w-fit rounded-full bg-brand-green/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-deep-forest">
                Open role
              </span>
              <h3 className="mt-3 font-heading text-lg font-semibold text-charcoal-ink">
                {role.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{role.teaser}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-charcoal-ink/60">
                {role.scope}
              </p>
              <Link
                href={`${MARKETING_ROUTES.contact}?source=careers&role=${role.id}`}
                className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-deep-forest hover:underline"
              >
                Get in touch
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
              </Link>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <p className="mx-auto mb-8 max-w-xl text-center font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl">
          Don&rsquo;t see the right seat, but think you&rsquo;d still be a fit?
        </p>
        <CtaBand
          title="Reach out anyway"
          description="We're a small team building fast. If you think you can help us close the gap between doctor visits, we want to hear from you."
          primaryHref={`${MARKETING_ROUTES.contact}?source=careers`}
          primaryLabel="Get in touch"
          secondaryHref={MARKETING_ROUTES.about}
          secondaryLabel="Meet the team"
        />
      </Section>
    </>
  );
}
