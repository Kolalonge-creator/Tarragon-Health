import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { PageHero, BlockHeading } from "../_components/page-hero";
import { Section } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { EligibilityChecker } from "../_components/eligibility-checker";
import { RoiCalculator } from "../_components/roi-calculator";
import { B2B_PAGES } from "../_content/b2b";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { employerSeatLine, employerSeatPriceLabel, MEMBERSHIP_INCLUDES, paidProductName } from "@/lib/marketing/membership";

export const metadata: Metadata = pageMetadata({
  title: "For employers and organisations",
  description:
    "Give every employee the same full Membership: a preventive plan, lab results reviewed by a doctor and a monthly doctor meeting. You see group figures only.",
  path: MARKETING_ROUTES.corporate,
});

/**
 * Employers & Organisations, website upgrade Phase 3 (2026-11-05, plan
 * section 7.5; founder decision W-05 folds the old /hmo page in as the
 * insurers section, and /hmo now redirects here). The employer seat price and
 * the inclusions come from the shared config reader (lib/marketing/membership.ts),
 * never typed. Workplace screening is a separately scoped service and is never
 * bundled into the seat price. No response time is typed: the old HMO copy
 * quoted 24/12 hours, which lives in signed escalation_slas and is shown on
 * /accountability instead.
 */
const STEPS = [
  { title: "Talk to us", body: "Tell us how many people you want to cover and what matters most to you." },
  { title: "Agree the programme", body: "We confirm the number of seats and the start date. Checks at your workplace, if you want them, are scoped and priced separately." },
  { title: "Your people join", body: "Each employee gets an invitation and creates their own private account. Joining takes a few minutes." },
  { title: "Group reporting", body: "You receive group figures, such as how many people have joined and completed their checks. Never anyone's results." },
] as const;

const PRIVACY = [
  "Each employee has their own private record and their own care team.",
  "You see counts and group figures only, never a name next to a result, a diagnosis or a medicine.",
  "Figures for very small groups are not shown, so nobody can be identified by elimination.",
  "An employee's care continues the same way whether their employer pays or they pay themselves.",
] as const;

export default function CorporatePage() {
  const name = paidProductName();
  const seatPrice = employerSeatPriceLabel();
  const offer = B2B_PAGES.corporate.partnerOffer;
  const enquiry = `${MARKETING_ROUTES.contact}?source=corporate&role=employer`;
  return (
    <>
      <PageHero
        eyebrow="For employers and organisations"
        title="Build a healthier, better supported team."
        description={`Give your people the same full ${name} anyone can buy: a preventive plan, laboratory results reviewed by a doctor, a monthly online doctor meeting and follow-up all year. You see group figures, never anyone's health.`}
        primary={{ href: enquiry, label: "Discuss an employer programme" }}
        secondary={{ href: "#coverage", label: "Check if your employer covers you" }}
      />

      <Section variant="sage" labelledBy="emp-offer-title">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <BlockHeading id="emp-offer-title" eyebrow="What each employee gets" title={`The same ${name}, for everyone you cover.`} />
            <ul className="grid gap-3">
              {MEMBERSHIP_INCLUDES.map((line) => (
                <li key={line} className="flex items-start gap-3 text-charcoal-ink">
                  <Check aria-hidden className="mt-1 h-[18px] w-[18px] shrink-0 text-brand-green" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="self-start rounded-3xl bg-clinical-navy p-7 text-white">
            <p className="text-sm font-semibold uppercase tracking-wider text-sprout-gold">Employer {name}</p>
            <p className="mt-3 text-white/90" data-testid="employer-seat-line">{employerSeatLine(seatPrice)}</p>
            <p className="mt-4 text-sm text-white/80">
              Laboratory tests are paid to the laboratory, and medicines to the pharmacy, as for any member.
            </p>
            <Link
              href={enquiry}
              className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-sprout-gold px-6 font-semibold text-[#1d1606] hover:bg-sprout-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sprout-gold focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy"
            >
              Discuss an employer programme
            </Link>
          </div>
        </div>
      </Section>

      <Section labelledBy="emp-steps-title">
        <BlockHeading id="emp-steps-title" eyebrow="How it works" title="From first conversation to a covered team." />
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid content-start gap-2 rounded-2xl border border-mk-border bg-white p-5">
              <span className="text-xs font-semibold uppercase tracking-wider text-brand-green">Step {i + 1}</span>
              <span className="text-lg font-semibold text-charcoal-ink">{s.title}</span>
              <span className="text-[15px] text-mk-muted">{s.body}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section variant="sage" labelledBy="emp-privacy-title">
        <BlockHeading
          id="emp-privacy-title"
          eyebrow="Privacy and reporting"
          title="You see the group. Never the person."
          description="Your people will only use a health benefit they trust. These rules are built into the platform, not left to policy."
        />
        <ul className="grid gap-4 md:grid-cols-2">
          {PRIVACY.map((line) => (
            <li key={line} className="flex items-start gap-3 rounded-2xl bg-white p-5 text-charcoal-ink">
              <Check aria-hidden className="mt-1 h-[18px] w-[18px] shrink-0 text-brand-green" />
              {line}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="insurers" labelledBy="emp-insurers-title">
        <BlockHeading
          id="emp-insurers-title"
          eyebrow="Health insurers and HMOs"
          title="Add ongoing preventive care for your members."
          description="Your members keep their insurance for treatment. Tarragon can add a preventive plan, review of their laboratory results and follow-up between visits. Members' results always stay between them and their care team. Tell us about your members and we will discuss how we could work together."
        />
        <Link
          href={`${MARKETING_ROUTES.contact}?source=hmo&role=hmo`}
          className="inline-flex h-12 items-center justify-center rounded-full border-[1.5px] border-brand-green px-6 font-semibold text-brand-green hover:bg-brand-green/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
        >
          Talk to us about working together
        </Link>
      </Section>

      {offer ? (
        <Section variant="navy" labelledBy="emp-funded-title">
          <BlockHeading id="emp-funded-title" eyebrow={offer.eyebrow} title={offer.title} description={offer.body} invert />
          <ul className="grid gap-3 text-white/90 md:grid-cols-2">
            {offer.points.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <Check aria-hidden className="mt-1 h-[18px] w-[18px] shrink-0 text-sprout-gold" />
                {p}
              </li>
            ))}
          </ul>
          <Link
            href={`${MARKETING_ROUTES.contact}?source=${encodeURIComponent("corporate-ngo")}&role=${encodeURIComponent(offer.ctaRole)}`}
            className="mt-8 inline-flex h-12 items-center justify-center rounded-full bg-sprout-gold px-6 font-semibold text-[#1d1606] hover:bg-sprout-gold/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sprout-gold focus-visible:ring-offset-2 focus-visible:ring-offset-clinical-navy"
          >
            {offer.ctaLabel}
          </Link>
        </Section>
      ) : null}

      <Section id="coverage" labelledBy="emp-coverage-title">
        <BlockHeading id="emp-coverage-title" eyebrow="Already covered?" title="Check if your employer covers you, or estimate the numbers." />
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <EligibilityChecker source="corporate" />
          <RoiCalculator audience="workforce" />
        </div>
      </Section>

      <Section variant="sage" className="pb-24">
        <CtaBand
          variant="gradient"
          title="Discuss an employer programme."
          description="Tell us about your organisation and we will reply personally with a clear quote."
          primaryHref={enquiry}
          primaryLabel="Discuss an employer programme"
          secondaryHref={MARKETING_ROUTES.membership}
          secondaryLabel={`What ${name} includes`}
        />
      </Section>
    </>
  );
}
