import { t } from "@tarragon/i18n";

/**
 * How a stated review time is shown. The number itself always comes from the ACTIVE signed escalation SLA
 * (`symptom_review_stated_time()`); this only words it. Whole hours read as hours, anything else as minutes.
 */
export function formatReviewTime(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return t("symptom.review.hours", "en", { n: minutes / 60 });
  return t("symptom.review.minutes", "en", { n: minutes });
}

export function reviewTimeSentence(time: { stated: false } | { stated: true; minutes: number }): string {
  return time.stated ? t("symptom.review.time_stated", "en", { time: formatReviewTime(time.minutes) }) : t("symptom.review.time_unstated");
}
