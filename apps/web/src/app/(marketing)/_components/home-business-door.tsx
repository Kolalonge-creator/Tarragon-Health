import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Section } from "./section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * The B2B front door on the homepage: one band, two links. Employers and HMOs
 * had no presence on the page below the nav, while competitors in the
 * category (Omada, Reliance, Cadence) keep a standing "for organisations"
 * route visible throughout. Copy mirrors /corporate and /hmo; it adds no
 * claim of its own, and the individual-privacy line matches I9 (institutions
 * see aggregates only).
 */
export function HomeBusinessDoor() {
  return (
    <Section className="py-10 sm:py-14">
      <div className="mx-auto grid max-w-5xl items-center gap-6 rounded-2xl border border-charcoal-ink/10 bg-white p-8 shadow-sm sm:p-10 lg:grid-cols-[1.3fr_0.7fr]">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
            For employers and HMOs
          </p>
          <h2 className="mt-2 font-heading text-2xl font-semibold text-charcoal-ink sm:text-3xl">
            Look after the people you cover, before the claim.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-charcoal-ink/70">
            Cover your staff or members with Tarragon. They get the same follow-up as every patient,
            and you get anonymised reporting on screening and risk. You never see an individual&apos;s
            health data.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 lg:flex-col">
          <Button asChild size="lg">
            <Link href={MARKETING_ROUTES.corporate}>For employers</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={MARKETING_ROUTES.hmo}>For HMOs</Link>
          </Button>
        </div>
      </div>
    </Section>
  );
}
