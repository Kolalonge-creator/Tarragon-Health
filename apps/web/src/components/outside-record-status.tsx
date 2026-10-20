import { t, type Locale } from "@tarragon/i18n";

import { outsideRecordLabel, type OutsideRecordStatusInput } from "@tarragon/shared";

// The rule (what an outside record may say about itself) lives in @tarragon/shared so the phone obeys the same one.
export { outsideRecordLabel, type OutsideRecordStatusInput, type OutsideRecordLabel, type OutsideRecordVerification } from "@tarragon/shared";

/** The single shared line for a patient-supplied record from another hospital. Null-gated: never says a doctor checked what no doctor checked. */
export function OutsideRecordStatus(props: OutsideRecordStatusInput & { locale?: Locale }) {
  const locale = props.locale ?? "en";
  const label = outsideRecordLabel(props);
  if (label.kind === "none") return null;
  if (label.kind === "unchecked") {
    return (
      <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="outside-record-unchecked">
        <p className="font-medium">{t("outside_records.status.unchecked", locale)}</p>
        <p className="mt-0.5">{t("outside_records.status.unchecked_help", locale)}</p>
      </div>
    );
  }
  if (label.kind === "verified") {
    return (
      <p className="mt-2 text-xs text-charcoal-ink/80 dark:text-night-ink/80" data-testid="outside-record-verified">
        {label.reviewerName
          ? t("outside_records.status.verified_by", locale, { name: label.reviewerName, date: label.date })
          : t("outside_records.status.verified_by_team", locale, { date: label.date })}
      </p>
    );
  }
  return (
    <div className="mt-2 text-xs text-charcoal-ink/80 dark:text-night-ink/80" data-testid="outside-record-not-verified">
      <p className="font-medium">{t("outside_records.status.not_verified", locale)}</p>
      {label.note ? <p className="mt-0.5">{label.note}</p> : null}
    </div>
  );
}
