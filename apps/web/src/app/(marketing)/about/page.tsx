import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Section, SectionHeading } from "../_components/section";
import { CtaBand } from "../_components/cta-band";
import { TrustPillars } from "../_components/trust-pillars";
import { LeadershipGrid } from "../_components/leadership-panel";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";

/**
 * Honest operating commitments, not vanity metrics — TarragonHealth is
 * pre-revenue, so this band states policy/approach (escalation SLA, pricing
 * model from CLAUDE.md) rather than achieved-scale numbers a company at this
 * stage can't truthfully claim. Deliberately no doctor:patient ratio here:
 * the 1:120 figure is under active review as we look at how far good
 * protocol/automation design can responsibly stretch doctor coverage, so it
 * isn't a settled public claim yet — don't reintroduce a specific ratio
 * without checking with the founder first.
 */
const ABOUT_COMMITMENTS = [
  {
    value: "4 hrs",
    label: "contact SLA on abnormal results",
    detail: "The clock starts the moment a result comes back abnormal, never on a schedule.",
  },
  {
    value: "₦ + $",
    label: "one price, either currency",
    detail: "Pay in naira at home, or in dollars from wherever you're keeping watch from.",
  },
  {
    value: "Built to scale",
    label: "how one doctor covers more ground",
    detail:
      "We invest in protocols, automation, and triage so a doctor can safely support far more patients than a traditional clinic, without cutting corners on review.",
  },
] as const;

export const metadata: Metadata = pageMetadata({
  title: "About",
  description:
    "Why TarragonHealth exists: continuity of care between doctor visits, for Nigerians and the people who love them.",
  path: MARKETING_ROUTES.about,
});

export default function AboutPage() {
  return (
    <>
      <Section className="pt-20">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-16">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
              About TarragonHealth
            </p>
            <h1 className="mt-4 font-heading text-4xl font-bold leading-[1.05] text-charcoal-ink sm:text-5xl lg:text-6xl">
              Built on one conviction: care shouldn&apos;t stop when the appointment ends.
            </h1>
          </div>
          <div className="lg:pt-3">
            <p className="text-lg leading-relaxed text-charcoal-ink/75">
              Chronic disease isn&apos;t managed in a fifteen-minute consultation. It&apos;s
              managed in the weeks after, in the dose that gets missed, the reading nobody
              sees, and the follow-up call that never comes. TarragonHealth exists to close
              that gap.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-charcoal-ink/75">
              We started in the emergency department, watching people arrive in crisis with
              conditions that were entirely manageable days or weeks earlier, if someone had
              been watching. That&apos;s the gap we built TarragonHealth to close, for families
              in Nigeria and for the people keeping watch on them from abroad.
            </p>
            <p className="mt-6 font-heading text-2xl font-semibold text-deep-forest">
              Care that stays with you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/signup">Get started</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="#team">Meet our team</Link>
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section variant="navy" className="py-14">
        <div className="grid gap-6 sm:grid-cols-3">
          {ABOUT_COMMITMENTS.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center"
            >
              <p className="font-heading text-3xl font-bold text-sprout-gold">{item.value}</p>
              <h3 className="mt-2 font-heading text-sm font-semibold uppercase tracking-wide text-white">
                {item.label}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{item.detail}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="The thesis"
          title="Continuity, not just monitoring"
          description="Prevention and chronic disease management share the same patient record at TarragonHealth. The same family, the same phone, and the same care team follow a person from a routine screening through an ongoing condition, and the story never resets."
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
              body: "Someone looking after a parent can be named as their next of kin, so they stay informed rather than left guessing. It is the parent's choice, not a default, and they can withdraw it.",
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

      <Section id="team" variant="sage">
        <SectionHeading
          eyebrow="Team"
          title="The people building TarragonHealth"
          description="Meet our founder, and see the seats we're building out next as TarragonHealth grows beyond one person. Click a card for the full story."
        />
        <LeadershipGrid />
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-charcoal-ink/70">
          Think you&rsquo;re a fit for one of the open seats?{" "}
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
        <p className="mx-auto mb-8 max-w-xl text-center font-heading text-xl font-semibold text-charcoal-ink sm:text-2xl">
          Continuity of care isn&apos;t a feature we bolted on. It&apos;s the whole product.
        </p>
        <CtaBand
          variant="gradient"
          title="Come build continuity of care with us"
          description="Whether you're a patient, a family member, an employer, or an HMO, we'd like to hear from you."
          primaryLabel="Get started"
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
