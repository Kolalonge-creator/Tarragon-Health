import { t } from "@tarragon/i18n";

/**
 * The fixed "when to get urgent help" box (spec 9.4). It is the same box under every learning item and under a record-triggered lesson,
 * with fixed copy that no author, creator or editor can change or leave out. It always outranks a lesson.
 */
export function UrgentHelpBox() {
  return (
    <aside
      role="note"
      aria-label={t("learn.urgent.title")}
      className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
      data-testid="urgent-help-box"
    >
      <p className="font-semibold">{t("learn.urgent.title")}</p>
      <p className="mt-1">{t("learn.urgent.body")}</p>
    </aside>
  );
}
