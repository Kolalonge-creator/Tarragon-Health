import Link from "next/link";
import { Section } from "./section";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * "What brings you here?" row directly under the hero.
 *
 * Added 2026-10-26 after a competitor review (Ubie, Kry, Omada): the homepage
 * had no input of any kind above the fold, while the strongest sites in the
 * category let a visitor start something in their first screen. These are
 * plain links into pages that already exist, so the row adds no new clinical
 * logic and no claim that needs sign-off. The symptom checker entry is the
 * only one that opens a tool; it is anonymous and saves nothing (see
 * symptom-checker/page.tsx).
 */
const ENTRIES = [
  { label: "High blood pressure", href: MARKETING_ROUTES.hypertension },
  { label: "Diabetes", href: MARKETING_ROUTES.diabetes },
  { label: "My weight", href: MARKETING_ROUTES.obesity },
  { label: "A symptom I'm noticing", href: MARKETING_ROUTES.symptomChecker },
  { label: "I'm healthy and want to stay that way", href: MARKETING_ROUTES.prevention },
] as const;

export function HomeEntryChips() {
  return (
    <Section className="py-8 sm:py-10">
      <p id="home-entry-heading" className="text-center font-heading text-lg font-semibold text-charcoal-ink">
        What brings you here?
      </p>
      <ul aria-labelledby="home-entry-heading" className="mt-4 flex flex-wrap justify-center gap-3">
        {ENTRIES.map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className="inline-flex min-h-11 items-center rounded-full border border-charcoal-ink/15 bg-white px-5 py-2.5 text-sm font-medium text-charcoal-ink shadow-sm transition-colors hover:border-brand-green/50 hover:text-brand-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
            >
              {entry.label}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
