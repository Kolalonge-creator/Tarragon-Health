import { t } from "@tarragon/i18n";

/**
 * P20: who reviewed a Learn item and when, read from the item's own record (health_education_content.reviewed_by_name / reviewed_at).
 * Null-gated: with no named reviewer it renders NOTHING, not a generic "reviewed by our clinical team" and not a bare date, so the page
 * never claims a review that has no record behind it. The date is shown only alongside a name.
 */
export function ReviewedByLine({ name, reviewedAt }: { name: string | null | undefined; reviewedAt?: string | null }) {
  const who = name?.trim();
  if (!who) return null;
  const on = reviewedAt?.trim() ? reviewedAt.trim().slice(0, 10) : null;
  return (
    <>
      <span data-testid="reviewed-by">{t("learn.trust.reviewed_by", "en", { name: who })}</span>
      {on ? <span data-testid="reviewed-on">{t("learn.trust.reviewed_on", "en", { date: on })}</span> : null}
    </>
  );
}
