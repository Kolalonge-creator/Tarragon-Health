import type { Metadata } from "next";
import Link from "next/link";
import { PageHero, BlockHeading } from "../_components/page-hero";
import { Section } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "For healthcare professionals",
  description:
    "How doctors work at Tarragon: signed care protocols, your name on every review, and technology that does the paperwork. Join the care team or partner with us.",
  path: MARKETING_ROUTES.clinicians,
});

/**
 * For healthcare professionals, website upgrade Phase 3 (2026-11-05, plan
 * section 7, "Healthcare professionals"). Describes how clinical work is
 * organised in terms already public on /clinical-approach and /accountability;
 * no headcount, ratio or caseload number is stated (the doctor:patient ratio is
 * under review, CLAUDE.md). Enquiries go through the ordinary contact form,
 * tagged by source, with no application flow promised.
 */
const HOW_WE_WORK = [
  { title: "Signed protocols", body: "Care follows protocols our Chief Medical Officer reviews and signs, versioned so you always know which rules applied." },
  { title: "Your name on your work", body: "Every review you complete carries your name in the patient's record. Nothing claims a doctor reviewed something that no doctor did." },
  { title: "Technology does the paperwork", body: "Laboratory reports are read into the record, results are compared with the rules, and urgent cases reach you first." },
  { title: "Remote, scheduled care", body: "Online meetings with patients, written questions and reviews of results, organised around clear priorities." },
] as const;

const WAYS = [
  {
    title: "Join the care team",
    body: "We work with MDCN-registered doctors who want to practise preventive and long-term care well. Tell us about your experience and interests.",
    href: `${MARKETING_ROUTES.contact}?source=clinicians&role=other`,
    cta: "Tell us about yourself",
  },
  {
    title: "Specialists and clinical partners",
    body: "If you lead a specialist service that our patients may need, we would like to hear how you work and where you practise.",
    href: `${MARKETING_ROUTES.contact}?source=clinicians-partner&role=other`,
    cta: "Discuss a partnership",
  },
  {
    title: "Laboratories and imaging centres",
    body: "Patients take their request forms to eligible laboratories in our directory. Tell us about your branches and services to be considered.",
    href: MARKETING_ROUTES.labs,
    cta: "For diagnostic providers",
  },
] as const;

export default function CliniciansPage() {
  return (
    <>
      <PageHero
        eyebrow="For healthcare professionals"
        title="Practise preventive care the way it should work."
        description="At Tarragon, doctors spend their time on clinical decisions. Protocols are signed, every review carries a name, and the platform handles collection, reminders and follow-up."
        primary={{ href: `${MARKETING_ROUTES.contact}?source=clinicians&role=other`, label: "Join the care team" }}
        secondary={{ href: MARKETING_ROUTES.clinicalApproach, label: "Our clinical approach" }}
      />

      <Section variant="sage" labelledBy="cl-work-title">
        <BlockHeading id="cl-work-title" eyebrow="How we work" title="Clinical work, organised properly." />
        <ul className="grid gap-4 md:grid-cols-2">
          {HOW_WE_WORK.map((w) => (
            <li key={w.title} className="grid gap-2 rounded-2xl bg-white p-6">
              <span className="text-lg font-semibold text-charcoal-ink">{w.title}</span>
              <span className="text-mk-muted">{w.body}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="cl-ways-title">
        <BlockHeading id="cl-ways-title" eyebrow="Work with us" title="Three ways to get involved." />
        <ul className="grid gap-4 md:grid-cols-3">
          {WAYS.map((w) => (
            <li key={w.title} className="grid content-start gap-3 rounded-2xl border border-mk-border bg-white p-6">
              <span className="text-lg font-semibold text-charcoal-ink">{w.title}</span>
              <span className="text-mk-muted">{w.body}</span>
              <Link href={w.href} className="inline-block py-1 font-semibold text-brand-green hover:underline">
                {w.cta}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[15px] text-charcoal-ink/80">
          See the roles we are hiring for on our{" "}
          <Link href={MARKETING_ROUTES.careers} className="inline-block py-1 font-semibold text-brand-green hover:underline">
            careers page
          </Link>
          .
        </p>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Questions about working with us?"
          description="Write to us and we will reply personally."
          primaryHref={`${MARKETING_ROUTES.contact}?source=clinicians&role=other`}
          primaryLabel="Contact us"
          secondaryHref={MARKETING_ROUTES.accountability}
          secondaryLabel="How we are accountable"
        />
      </Section>
    </>
  );
}
