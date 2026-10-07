"use client";

import Link from "next/link";
import { t } from "@tarragon/i18n";
import type { AddCheckFinding } from "@tarragon/medicines";
import { Button } from "@/components/ui/button";

/**
 * What a patient sees before a new medicine is added, when the interaction and duplication check found something (spec 8.7).
 * It ADVISES only: the sentences are fixed and reviewed, they say "your care team", and they never tell anyone to stop a
 * medicine. Adding is always possible; nothing here blocks it, changes a prescription or messages anyone by itself.
 */
export function AddCheckPanel({
  findings,
  pending,
  onContinue,
}: {
  findings: AddCheckFinding[];
  pending: boolean;
  onContinue: () => void;
}) {
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-300">{t("medicines.addcheck.title")}</p>
      <ul className="space-y-2">
        {findings.map((finding, index) => (
          <li key={`${finding.adviceKey}-${index}`} className="rounded-md bg-white/70 p-2 dark:bg-night-ink/20">
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{[...new Set(finding.drugNames)].join(" · ")}</p>
            <p className="mt-1 text-sm text-charcoal-ink dark:text-night-ink">{t(finding.adviceKey)}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-900/80 dark:text-amber-300/80">{t("medicines.addcheck.limits")}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" className="min-h-11">
          <Link href="/patient/messages">{t("medicines.addcheck.contact")}</Link>
        </Button>
        <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={pending} onClick={onContinue}>
          {t("medicines.addcheck.continue")}
        </Button>
      </div>
    </div>
  );
}
