import { t } from "@tarragon/i18n";

/**
 * Danger signs for the cycle section. This sits OUTSIDE the private lock on purpose (S66): it is the same for everybody, holds no personal
 * data and prints no phone number, so anyone looking at a locked screen can still see that heavy bleeding, fainting or severe pain means go
 * to a hospital now. Wording is proposed copy awaiting CMO review (packages/i18n cycle-copy.ts).
 */
export function CycleDangerSigns() {
  return (
    <section aria-labelledby="cycle-danger-title" className="rounded-lg border-l-4 border-red-600 bg-red-50 p-4 dark:bg-red-500/15">
      <h2 id="cycle-danger-title" className="text-sm font-semibold text-red-800 dark:text-red-300">
        {t("cycle.danger.title")}
      </h2>
      <p className="mt-1 text-sm text-red-900/90 dark:text-red-200">{t("cycle.danger.intro")}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-900/90 dark:text-red-200">
        <li>{t("cycle.danger.item_1")}</li>
        <li>{t("cycle.danger.item_2")}</li>
        <li>{t("cycle.danger.item_3")}</li>
        <li>{t("cycle.danger.item_4")}</li>
      </ul>
      <p className="mt-2 text-sm text-red-900/90 dark:text-red-200">{t("cycle.danger.soon")}</p>
    </section>
  );
}
