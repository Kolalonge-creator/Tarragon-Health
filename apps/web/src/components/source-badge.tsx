import { getProposedConfig, isEstimateBpSource, cufflessCalibration, cufflessNoteIsQuiet, RECHECK_WITH_FINGERTIP_OXIMETER, entryOriginLabelKey, sourceBadgeLabel, type CufflessCalibrationConfig } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { formatPatientDate } from "@/lib/format-date";

/**
 * Where a reading came from, on every reading in every list (S70a, 18.9). A typed value, a Bluetooth device, a watch or wearable, a glucose
 * sensor and a photo the person checked each read differently, so nobody mistakes a wrist estimate for a fingertip test (53.9). The words
 * come from one place, `sourceBadgeLabel` in the shared package, so web and phone say the same thing.
 */
export function SourceBadge({ source, origin }: { source: string | null | undefined; origin?: string | null | undefined }) {
  // S07y: a reading taken at a pharmacy or clinic machine, or copied from a paper diary, says so. The label replaces "Typed by you" (the reading was
  // still typed by the person, but where it came from is the more useful fact), and is never left out of any list.
  const originKey = entryOriginLabelKey(origin);
  return (
    <span
      data-testid="source-badge"
      className="ml-2 inline-block rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-[11px] font-medium text-charcoal-ink/60 dark:bg-night-ink/15 dark:text-night-ink/60"
    >
      {originKey ? t(originKey) : sourceBadgeLabel(source)}
    </span>
  );
}

/**
 * An oxygen reading from a wrist or watch sensor can be less accurate, so the person is asked to check again with a fingertip oximeter
 * (A12). Shown under the reading itself, for any SpO2 that arrived through a wearable or a phone health bridge.
 */
export function WristSpo2Note({ source, vitalType }: { source: string | null | undefined; vitalType: string }) {
  if (vitalType !== "spo2" || source !== "wearable") return null;
  return (
    <p data-testid="wrist-spo2-note" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
      {RECHECK_WITH_FINGERTIP_OXIMETER}
    </p>
  );
}

/**
 * Under a wearable (cuffless) blood pressure estimate (S70b): says it is an estimate, when it was last compared with a real cuff, and, once that
 * comparison is stale, that it is only a rough guide. A label only: it never changes the number, the grade or an alert. `lastCuffCheckAt` is
 * `undefined` when it could not be looked up (then only "Estimate" and the cuff-check line show, never a claim about the date), `null` when the person
 * has no cuff reading at all. The number of days comes from the PROPOSED `bp.cuffless_calibration` configuration.
 */
export function CufflessCalibrationNote({
  source,
  vitalType,
  lastCuffCheckAt,
  level,
  now = new Date(),
}: {
  source: string | null | undefined;
  vitalType: string;
  lastCuffCheckAt: string | null | undefined;
  /** The live band of this estimate (green, amber, red, emergency, unknown). A raised band keeps only the factual line: the usual guidance is shown elsewhere. */
  level?: string | null;
  now?: Date;
}) {
  if (vitalType !== "blood_pressure" || !isEstimateBpSource(source)) return null;
  const cfg = getProposedConfig("bp.cuffless_calibration").value as unknown as CufflessCalibrationConfig;
  const quiet = cufflessNoteIsQuiet(level);
  let line: string | null = t("cle.unknown");
  if (lastCuffCheckAt !== undefined) {
    const state = cufflessCalibration(lastCuffCheckAt, now, cfg);
    line =
      state.kind === "never"
        ? t("cle.never")
        : t(state.kind === "stale" && !quiet ? "cle.stale" : "cle.checked", "en", { date: formatPatientDate(state.lastCheckedAt) });
  }
  return (
    <p data-testid="cuffless-calibration-note" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
      <span className="font-medium">{t("cle.estimate")}.</span> {line ? `${line}. ` : ""}
      {quiet ? null : t("cle.note")}
    </p>
  );
}
