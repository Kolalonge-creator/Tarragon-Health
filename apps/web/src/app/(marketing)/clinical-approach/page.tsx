import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageHero, BlockHeading } from "../_components/page-hero";
import { Section } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { EmergencyNotice } from "../_components/emergency-notice";
import { TEAM } from "../_content/leadership";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "Our clinical approach",
  description:
    "How Tarragon chooses tests, reviews results and decides when something needs action, who is accountable, and what digital care cannot do.",
  path: MARKETING_ROUTES.clinicalApproach,
});

/**
 * Our clinical approach, website upgrade Phase 2 (2026-11-05, plan section
 * 7.8). Describes the process in general terms only. No turnaround time is
 * typed here: the live, signed response times are on /accountability, read
 * from escalation_slas, and this page links there instead of repeating a
 * number that could drift. Names only the leadership already public on /about.
 */
const PRINCIPLES = [
  {
    title: "Prevention first",
    body: "Many serious conditions, such as high blood pressure, diabetes and kidney disease, can be found early with simple checks. Finding them early gives you more choices.",
  },
  {
    title: "Your risk, not one panel for everyone",
    body: "Tests are recommended because they fit your age, sex, history and family history. We avoid tests you do not need.",
  },
  {
    title: "Doctors make clinical decisions",
    body: "Software organises your information and flags what needs attention. Interpreting a result, changing a treatment and deciding next steps are done by doctors.",
  },
  {
    title: "Follow-up over time",
    body: "A single result tells you about one day. We look at results over months and years, so a slow change is noticed before it becomes a problem.",
  },
] as const;

const REVIEW_STEPS = [
  { title: "Your report arrives", body: "You upload a photo or PDF of a report from any laboratory. The original is kept unchanged." },
  { title: "Values are read and checked", body: "Software reads each test, value, unit and range. Anything unclear is held for a person to check rather than guessed." },
  { title: "Results are compared with care rules", body: "Each value is checked against ranges in protocols our Chief Medical Officer signs, and against your earlier results." },
  { title: "A doctor reviews it", body: "On Membership, a doctor reviews your result, writes a plain-English explanation and sets the next step." },
  { title: "Anything urgent is moved up", body: "An abnormal result is put in front of a doctor ahead of routine work, and a critical one is followed up urgently." },
] as const;

const LIMITS = [
  "We cannot examine you in person. Some problems need a doctor to see you, and we will tell you when that is the case.",
  "We rely on the readings and reports you give us. A wrong reading or a mixed-up report can mislead anyone, so we check what looks unusual.",
  "Laboratories differ. We use the reference range on your report and our own care rules, and a doctor decides what matters.",
  "Tarragon is not an emergency service. If you are very unwell, go to the nearest hospital now; do not wait for a message from us.",
] as const;

export default function ClinicalApproachPage() {
  const cmo = TEAM.find((m) => m.title === "Chief Medical Officer");
  return (
    <>
      <PageHero
        eyebrow="Our clinical approach"
        title="Technology that helps, with doctors who decide."
        description="How we choose your tests, review your results and decide when something needs action, and the limits we want you to know about."
        primary={{ href: MARKETING_ROUTES.accountability, label: "See our response times" }}
        secondary={{ href: MARKETING_ROUTES.howItWorks, label: "How it works" }}
      />

      <Section variant="sage" labelledBy="ca-principles-title">
        <BlockHeading id="ca-principles-title" eyebrow="Principles" title="What guides our care." />
        <ul className="grid gap-4 md:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <li key={p.title} className="grid gap-2 rounded-2xl bg-white p-6">
              <span className="text-lg font-semibold text-charcoal-ink">{p.title}</span>
              <span className="text-mk-muted">{p.body}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="ca-tests-title">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <BlockHeading
              id="ca-tests-title"
              eyebrow="Choosing tests"
              title="Tests that fit you."
              description="Your preventive plan comes from care protocols that our Chief Medical Officer reviews and signs, based on recognised clinical guidance."
            />
            <ul className="grid gap-3 text-charcoal-ink/85">
              <li>A test is recommended only when your age, sex, history or risk makes it useful.</li>
              <li>Some tests, such as HIV or hepatitis B, are offered only with your consent.</li>
              <li>When a protocol changes, the new version is signed before it is used, and the old version is kept on record.</li>
            </ul>
          </div>
          <div>
            <BlockHeading id="ca-review-title" eyebrow="Reviewing results" title="What happens to a result." />
            <ol className="grid gap-3">
              {REVIEW_STEPS.map((step, i) => (
                <li key={step.title} className="grid grid-cols-[2rem_1fr] gap-3">
                  <span className="font-heading text-2xl text-brand-green" aria-hidden>
                    {i + 1}
                  </span>
                  <span>
                    <span className="block font-semibold text-charcoal-ink">{step.title}</span>
                    <span className="text-[15px] text-mk-muted">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-[15px] text-charcoal-ink/80">
              Our response times are signed by our Chief Medical Officer and published on{" "}
              <Link href={MARKETING_ROUTES.accountability} className="inline-block py-1 font-semibold text-brand-green hover:underline">
                how we are accountable
              </Link>
              .
            </p>
          </div>
        </div>
      </Section>

      <Section variant="sage" labelledBy="ca-people-title">
        <BlockHeading
          id="ca-people-title"
          eyebrow="Who is accountable"
          title="Named people, not a faceless service."
          description="Every review a doctor makes carries that doctor's name in your record. Our clinical work is led by our Chief Medical Officer, who signs the protocols our care follows."
        />
        {cmo ? (
          <div className="flex max-w-xl items-center gap-4 rounded-2xl bg-white p-5">
            {cmo.photoSrc ? (
              <Image src={cmo.photoSrc} alt="" width={72} height={72} className="h-[72px] w-[72px] shrink-0 rounded-full object-cover" />
            ) : null}
            <span className="grid">
              <span className="font-semibold text-charcoal-ink">{cmo.name}</span>
              <span className="text-sm text-charcoal-ink/80">{cmo.title}</span>
              {cmo.credentials ? <span className="text-xs text-mk-muted">{cmo.credentials}</span> : null}
            </span>
          </div>
        ) : null}
        <p className="mt-5">
          <Link href={MARKETING_ROUTES.about} className="inline-block py-1 font-semibold text-brand-green hover:underline">
            Meet our leadership
          </Link>
        </p>
      </Section>

      <Section labelledBy="ca-limits-title">
        <BlockHeading id="ca-limits-title" eyebrow="Limits" title="What digital care cannot do." />
        <ul className="grid gap-4 md:grid-cols-2">
          {LIMITS.map((line) => (
            <li key={line} className="border-t border-mk-border pt-4 text-charcoal-ink/85">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[15px] text-charcoal-ink/80">
          You decide who in your family can see your care, and an employer never sees your results.{" "}
          <Link href={MARKETING_ROUTES.privacy} className="inline-block py-1 font-semibold text-brand-green hover:underline">
            Read how we handle your data
          </Link>
          .
        </p>
      </Section>

      <Section>
        <EmergencyNotice />
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Questions about our clinical work?"
          description="Ask us directly. We would rather answer a hard question before you join than after."
          primaryHref={MARKETING_ROUTES.contact}
          primaryLabel="Contact us"
          secondaryHref="/signup"
          secondaryLabel="Get started"
        />
      </Section>
    </>
  );
}
