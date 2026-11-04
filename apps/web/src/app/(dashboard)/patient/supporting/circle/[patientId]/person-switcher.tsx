"use client";

import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import type { SupportedPerson } from "@/lib/care-circle/model";

/**
 * Care Circle P2 (spec 5.1): someone who supports more than one person moves between them here. Each person is a separate page with its
 * own read (the URL carries the patient id, and the database gate is checked again on every read), so nothing from one person's page is
 * ever shown on another's. Hidden for a supporter of one person.
 */
export function PersonSwitcher({ people, current, locale }: { people: readonly SupportedPerson[]; current: string; locale: Locale }) {
  if (people.length < 2) return null;
  return (
    <nav aria-label={t("circlep2.switcher.label", locale)} className="-mx-1 overflow-x-auto">
      <ul className="flex gap-2 px-1 pb-1">
        {people.map((p) => {
          const here = p.patient_id === current;
          return (
            <li key={p.patient_id}>
              <Link
                href={`/patient/supporting/circle/${p.patient_id}`}
                aria-current={here ? "page" : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm ${
                  here ? "border-brand-green bg-brand-green text-white" : "border-charcoal-ink/20 hover:bg-charcoal-ink/5 dark:border-night-ink/25"
                }`}
              >
                {p.name}
                {p.relationship ? <span className="sr-only"> ({p.relationship})</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
