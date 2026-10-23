import { t } from "@tarragon/i18n";
import { confidenceDots, cycleStatus, type CycleConfidence, type CyclePrediction, type PeriodInProgress } from "@tarragon/shared";
import { CalendarClock, Clock, Info } from "lucide-react";

/**
 * UI-A: the one plain-word status at the top of the cycle card, and the confidence in words plus a three-dot scale. Both come from the
 * prediction the engine already returned (shared `cycleStatus` / `confidenceDots`), so they cannot disagree with the numbers beside
 * them and invent no certainty. The tint is green, amber for "a little later than the estimate", or grey. Never red.
 */

export function statusSentence(prediction: CyclePrediction, inProgress?: PeriodInProgress | null): string {
  const s = cycleStatus(prediction, inProgress);
  switch (s.kind) {
    case "in_progress":
      if (s.days === 0 || s.days === null) return t("cycle.status.started_today");
      return s.days === 1 ? t("cycle.status.started_one") : t("cycle.status.started_days", undefined, { days: s.days });
    case "no_history":
      return t("cycle.status.no_history");
    case "today":
      return t("cycle.status.today");
    case "any_day":
      return t("cycle.status.any_day");
    case "overdue":
      if (s.days === null) return t("cycle.status.overdue");
      return s.days === 1 ? t("cycle.status.overdue_one") : t("cycle.status.overdue_days", undefined, { days: s.days });
    case "in_days":
      return s.days === 1 ? t("cycle.status.in_one_day") : t("cycle.status.in_days", undefined, { days: s.days ?? 0 });
  }
}

export function confidenceSentence(confidence: CycleConfidence): string {
  return t(`cycle.confidence.${confidence}` as const);
}

export function ConfidenceDots({ confidence }: { confidence: CycleConfidence }) {
  const filled = confidenceDots(confidence);
  return (
    <span role="img" aria-label={t("cycle.confidence.dots_label", undefined, { n: filled })} className="inline-flex items-center gap-1">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          aria-hidden
          className={`inline-block h-3 w-3 rounded-full border-2 border-brand-green dark:border-brand-green-bright ${
            n <= filled ? "bg-brand-green dark:bg-brand-green-bright" : "bg-transparent"
          }`}
        />
      ))}
    </span>
  );
}

/** Confidence as a sentence with its dots: "Early estimate. It gets better after 3 cycles." */
export function ConfidenceLine({ confidence }: { confidence: CycleConfidence }) {
  return (
    <p className="flex items-center gap-2 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
      <ConfidenceDots confidence={confidence} />
      <span>{confidenceSentence(confidence)}</span>
    </p>
  );
}

export function CycleStatusLine({ prediction, inProgress }: { prediction: CyclePrediction; inProgress?: PeriodInProgress | null }) {
  const status = cycleStatus(prediction, inProgress);
  const tone =
    status.tone === "amber"
      ? "bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
      : status.tone === "grey"
        ? "bg-charcoal-ink/5 text-charcoal-ink/80 dark:bg-night-ink/10 dark:text-night-ink/80"
        : "bg-soft-sage/50 text-deep-forest dark:bg-brand-green/10 dark:text-night-ink";
  const Icon = status.tone === "amber" ? Clock : status.tone === "grey" ? Info : CalendarClock;
  return (
    <div className={`flex items-center gap-3 rounded-lg p-3 ${tone}`} data-testid="cycle-status-line">
      <Icon className="h-6 w-6 shrink-0" strokeWidth={2} aria-hidden />
      <p role="status" className="text-base font-semibold">
        {statusSentence(prediction, inProgress)}
      </p>
    </div>
  );
}
