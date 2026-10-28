import { t } from "@tarragon/i18n";

/** What `pharmacy_snapshot_by_token` returns on success. */
export type CounterData = {
  status: "ok";
  kind: "pharmacy_counter";
  full_name: string;
  expires_at: string;
  session_ends_at?: string | null;
  medications?: Array<{ drug_name: string; dose: string | null; frequency: string | null; is_active: boolean }>;
  adherence: {
    min_doses: number;
    weeks: Array<{
      week_start: string;
      week_end: string;
      due: number;
      marked_taken: number;
      late: number;
      skipped: number;
      no_record: number;
      could_not_get: number;
      percent: number | null;
    }>;
  };
};

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * The pharmacist's view: the patient's own "doses marked taken" figures (frozen when they made the page) and the medicines list. Self-report only.
 * No grade, no threshold, no colour judgement; skipped doses are shown apart from missed ones.
 */
export function CounterView({ record }: { record: CounterData }) {
  const closes = record.session_ends_at ?? record.expires_at;
  return (
    <main className="mx-auto max-w-xl space-y-5 p-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-tarragon-green">TarragonHealth</p>
        <h1 className="mt-1 text-lg font-semibold text-charcoal-ink">{t("pharm_snapshot.public.title")}</h1>
        <p className="text-sm text-charcoal-ink">{t("pharm_snapshot.public.for", "en", { name: record.full_name })}</p>
        <p className="mt-2 text-sm text-charcoal-ink/70">{t("pharm_snapshot.public.what")}</p>
      </header>

      <section className="space-y-3">
        {record.adherence.weeks.map((w) => (
          <div key={w.week_start} className="rounded-lg border border-charcoal-ink/10 p-3 text-sm text-charcoal-ink">
            <p className="font-medium">{t("pharm_snapshot.public.week", "en", { start: day(w.week_start), end: day(w.week_end) })}</p>
            <p>
              {w.percent === null
                ? t("pharm_snapshot.public.not_enough", "en", { taken: w.marked_taken, due: w.due })
                : t("pharm_snapshot.public.percent", "en", { percent: w.percent, taken: w.marked_taken, due: w.due })}
            </p>
            <p className="text-charcoal-ink/70">{t("pharm_snapshot.public.skipped", "en", { n: w.skipped })}</p>
            <p className="text-charcoal-ink/70">{t("pharm_snapshot.public.no_record", "en", { n: w.no_record })}</p>
            {w.could_not_get > 0 && <p className="text-charcoal-ink/70">{t("pharm_snapshot.public.could_not_get", "en", { n: w.could_not_get })}</p>}
          </div>
        ))}
      </section>

      {record.medications && record.medications.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-charcoal-ink">{t("pharm_snapshot.public.medicines")}</h2>
          <ul className="mt-1 space-y-1 text-sm text-charcoal-ink">
            {record.medications.map((m, i) => (
              <li key={`${m.drug_name}-${i}`}>{[m.drug_name, m.dose, m.frequency].filter(Boolean).join(", ")}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-charcoal-ink/60">{t("pharm_snapshot.public.closes", "en", { time: time(closes) })}</p>
    </main>
  );
}
