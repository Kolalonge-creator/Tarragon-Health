import Link from "next/link";
import { t } from "@tarragon/i18n";

/**
 * Danger signs for the cycle section. This sits OUTSIDE the private lock on purpose (S66): it is the same for everybody, holds no personal
 * data and prints no phone number, so anyone looking at a locked screen can still see that heavy bleeding, fainting or severe pain means go
 * to a hospital now. Wording is proposed copy awaiting CMO review (packages/i18n cycle-copy.ts).
 *
 * UI-A: follows the standard alert template in this order: what to look out for, what it may mean, one step, a button to message the care
 * team. No exclamation marks, no capitals-only words. A true clinical safety card, so it keeps the red edge; nothing else on the page does.
 */
export function CycleDangerSigns() {
  return (
    <section aria-labelledby="cycle-danger-title" className="space-y-3 rounded-lg border-l-4 border-red-600 bg-red-50 p-4 dark:bg-red-500/15">
      <h2 id="cycle-danger-title" className="text-base font-semibold text-red-800 dark:text-red-300">
        {t("cycle.danger.title")}
      </h2>
      <div>
        <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">{t("cycle.danger.noticed_label")}</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-900/90 dark:text-red-200">
          <li>{t("cycle.danger.item_1")}</li>
          <li>{t("cycle.danger.item_2")}</li>
          <li>{t("cycle.danger.item_3")}</li>
          <li>{t("cycle.danger.item_4")}</li>
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">{t("cycle.danger.meaning_label")}</h3>
        <p className="mt-1 text-sm text-red-900/90 dark:text-red-200">{t("cycle.danger.meaning")}</p>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">{t("cycle.danger.step_label")}</h3>
        <p className="mt-1 text-sm text-red-900/90 dark:text-red-200">{t("cycle.danger.intro")}</p>
        <p className="mt-1 text-sm text-red-900/90 dark:text-red-200">{t("cycle.danger.soon")}</p>
      </div>
      <Link
        href="/patient/messages"
        className="inline-flex min-h-10 items-center rounded-md border border-red-700 px-4 text-sm font-medium text-red-900 hover:bg-red-100 dark:border-red-300 dark:text-red-100 dark:hover:bg-red-500/20"
      >
        {t("cycle.danger.message_button")}
      </Link>
    </section>
  );
}
