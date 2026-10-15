import { t, type Locale } from "@tarragon/i18n";

export interface ClinicianIntake {
  id: string;
  source: "manual" | "symptom_checker";
  summary: string;
  sent_at: string;
}

/**
 * S64 (15.3): what the patient sent before the visit, in the clinician's view of this encounter. Null (nothing sent) says so plainly.
 * The summary was written by plain code when the patient pressed send; it is the patient's words and is not a diagnosis.
 */
export function ClinicianIntakePanel({ intake, locale = "en" }: { intake: ClinicianIntake | null; locale?: Locale }) {
  return (
    <section className="space-y-1 rounded-md border border-charcoal-ink/10 p-3 text-sm dark:border-night-ink/15" aria-label={t("intake.clinician.title", locale)}>
      <h2 className="font-medium">{t("intake.clinician.title", locale)}</h2>
      {intake ? (
        <>
          <p className="whitespace-pre-line">{intake.summary}</p>
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("intake.clinician.note", locale)}</p>
        </>
      ) : (
        <p className="text-charcoal-ink/70 dark:text-night-ink/70">{t("intake.clinician.none", locale)}</p>
      )}
    </section>
  );
}
