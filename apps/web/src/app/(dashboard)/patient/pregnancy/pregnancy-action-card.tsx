import { t } from "@tarragon/i18n";

/**
 * The two fixed cards of the pregnancy tools (S67): "contact your care team today" and "go now". Fixed wording, never advice to hold off,
 * draft pending CMO review (OQ-343). It holds no personal figure.
 */
export function PregnancyActionCard({ variant, extra }: { variant: "contact_today" | "go_now"; extra?: string }) {
  const title = variant === "go_now" ? t("preg.card.go_now.title") : t("preg.card.contact_today.title");
  const body = variant === "go_now" ? t("preg.card.go_now.body") : t("preg.card.contact_today.body");
  return (
    <div role="alert" className="rounded-lg border-l-4 border-red-600 bg-red-50 p-4 dark:bg-red-500/15" data-testid={`preg-card-${variant}`}>
      <p className="text-base font-semibold text-red-800 dark:text-red-300">{title}</p>
      <p className="mt-1 text-sm text-red-900/90 dark:text-red-200">{body}</p>
      {extra && <p className="mt-1 text-sm text-red-900/90 dark:text-red-200">{extra}</p>}
    </div>
  );
}
