"use client";

import { useMemo } from "react";
import { catalogueLabel, searchCatalogue, type CatalogueEntry } from "@tarragon/medicines";
import { t } from "@tarragon/i18n";
import { useMedicineCatalogue } from "@/lib/queries/medicine-catalogue";

/**
 * Search-as-you-type suggestions under the medicine name box (spec 8.1, 8.2).
 *
 * A suggestion only FILLS the form; the patient still confirms every field, and a name that is not listed is always fine. A
 * catalogue row that no pharmacist has checked against NAFDAC's register says so, in plain words, rather than looking official.
 */
export function MedicineNameSuggestions({ query, onPick }: { query: string; onPick: (entry: CatalogueEntry) => void }) {
  const catalogue = useMedicineCatalogue();
  const matches = useMemo(() => searchCatalogue(catalogue.data ?? [], query, 6), [catalogue.data, query]);
  const trimmed = query.trim();

  if (trimmed.length < 2 || catalogue.isError) return null;
  if (matches.length === 0) {
    return catalogue.isPending ? null : <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("medicines.search.none")}</p>;
  }
  return (
    <div className="space-y-1">
      <ul aria-label={t("medicines.search.label")} className="divide-y divide-charcoal-ink/10 overflow-hidden rounded-md border border-charcoal-ink/15 dark:divide-night-ink/15 dark:border-night-ink/20">
        {matches.map(({ entry }) => (
          <li key={entry.id}>
            <button
              type="button"
              className="min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-charcoal-ink/5 dark:hover:bg-night-ink/10"
              onClick={() => onPick(entry)}
            >
              {catalogueLabel(entry)}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("medicines.search.unverified")}</p>
    </div>
  );
}
