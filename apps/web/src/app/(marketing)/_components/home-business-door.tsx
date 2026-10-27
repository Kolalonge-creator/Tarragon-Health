import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Section } from "./section";
import { B2B_PAGES } from "../_content/b2b";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * The B2B front door on the homepage. Employers and HMOs had no presence on
 * the page below the nav, while competitors in the category (Omada, Reliance,
 * Cadence) keep a standing "for organisations" route visible throughout.
 *
 * Every line is read from B2B_PAGES, the same content /corporate and /hmo
 * render, so the homepage can never state a stronger guarantee than the pages
 * it links to (including the aggregate-only rule: institutions see cohorts,
 * never an individual).
 */
const DOORS = [
  { page: B2B_PAGES.corporate, label: "For employers", href: MARKETING_ROUTES.corporate },
  { page: B2B_PAGES.hmo, label: "For HMOs", href: MARKETING_ROUTES.hmo },
] as const;

export function HomeBusinessDoor() {
  return (
    <Section className="py-10 sm:py-14">
      <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-2">
        {DOORS.map(({ page, label, href }) => (
          <Card key={page.slug} className="rounded-2xl">
            <CardContent className="flex h-full flex-col p-7">
              <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">{label}</p>
              <h2 className="mt-2 font-heading text-xl font-semibold text-charcoal-ink">
                {page.campaignLine}
              </h2>
              <ul className="mt-4 space-y-2 text-sm leading-relaxed text-charcoal-ink/75">
                {page.included.slice(0, 3).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className="mt-auto pt-6">
                <Button asChild variant="outline" size="lg">
                  <Link href={href}>{page.ctaLabel}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}
