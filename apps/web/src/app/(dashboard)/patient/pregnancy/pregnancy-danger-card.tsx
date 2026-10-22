"use client";

import { t } from "@tarragon/i18n";
import { PREGNANCY_DANGER_SIGNS, PREGNANCY_DANGER_SIGN_LABEL } from "@/lib/validation/womens-health";
import { useMaternalFollowUpOpen } from "@/lib/queries/growth";

/**
 * The danger-sign card (S67 16.8). Plain static text, no request needed to show the list, no personal figure, so it sits OUTSIDE the
 * private lock (S66, INV-06) and can be read on a locked screen. Same signs the red-flag check sends to the care team. Hidden for real
 * patients until the maternal go-live guard is open (test accounts pass); an unreadable guard counts as closed.
 */
export function PregnancyDangerCard() {
  const open = useMaternalFollowUpOpen();
  if (open.data !== true) return null;
  return (
    <section aria-labelledby="preg-danger-title" className="rounded-lg border-l-4 border-red-600 bg-red-50 p-4 dark:bg-red-500/15">
      <h2 id="preg-danger-title" className="text-sm font-semibold text-red-800 dark:text-red-300">{t("preg.ui.offline.title")}</h2>
      <p className="mt-1 text-sm text-red-900/90 dark:text-red-200">{t("preg.ui.offline.intro")}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-900/90 dark:text-red-200">
        {PREGNANCY_DANGER_SIGNS.map((sign) => (
          <li key={sign}>{PREGNANCY_DANGER_SIGN_LABEL[sign]}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm font-medium text-red-900 dark:text-red-100">{t("preg.ui.offline.action")}</p>
    </section>
  );
}
