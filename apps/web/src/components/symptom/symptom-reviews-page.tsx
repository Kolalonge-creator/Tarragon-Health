import Link from "next/link";
import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { symptomOptionLabel } from "@/lib/symptom-triage/option-label";
import { completeSymptomReviewAction } from "@/app/(dashboard)/clinician/symptom-reviews/actions";
import { NotADiagnosis } from "./not-a-diagnosis";

type QueueRow = { id: string; status: string; requested_at: string; due_at: string | null; patient_ref: string | null };
type Detail = {
  status: "ok" | "denied" | "not_found";
  review?: { id: string; review_status: string; requested_at: string; due_at: string | null };
  assessment?: {
    complaint: string;
    category: string;
    override_category: string | null;
    rationale: string;
    capture: { onset?: string; severity?: number; associatedSymptoms?: string[]; triggers?: string[]; relevantHistory?: string[] };
  };
  patient?: { name: string | null; patient_number: string | null; sex: string | null; age_years: number | null };
};

const CATEGORIES = ["emergency", "urgent", "routine", "self_management"] as const;
const card = "space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card";
const field = "mt-1 block w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
}

/**
 * S60 (spec 12.10): the clinician's queue of symptom check reviews and the review form. The queue shows a patient number and times
 * only; opening one calls the audited read (INV-10, INV-12), which refuses a clinician who holds no task for the patient and
 * records that refusal. There is no direct table read on this page.
 */
export async function SymptomReviewsPage({ reviewId, outcome }: { reviewId?: string; outcome?: string }) {
  const supabase = await createClient();
  const list = await supabase.rpc("list_my_symptom_reviews");
  const rows: QueueRow[] = Array.isArray(list.data) ? (list.data as unknown as QueueRow[]) : [];

  let detail: Detail | null = null;
  if (reviewId && /^[0-9a-f-]{36}$/i.test(reviewId)) {
    const read = await supabase.rpc("read_symptom_review_audited", {
      p_review: reviewId,
      p_reason: `${t("symptom.clinician.reason")} (${reviewId.slice(0, 8)})`,
    });
    detail = read.error ? { status: "denied" } : (read.data as unknown as Detail);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink">{t("symptom.clinician.title")}</h1>
        <p className="text-sm text-charcoal-ink/70">{t("symptom.clinician.intro")}</p>
      </header>

      {outcome === "done" && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t("symptom.clinician.form.done")}</p>}
      {outcome && outcome !== "done" && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("symptom.clinician.form.error")}</p>}

      <section className={card}>
        {list.error ? (
          <p className="text-sm text-charcoal-ink/70">{t("symptom.clinician.empty")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("symptom.clinician.empty")}</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-mono text-xs">{r.patient_ref ?? "-"}</span>
                <span className="text-charcoal-ink/70">
                  {r.due_at ? t("symptom.clinician.due", "en", { when: when(r.due_at) }) : t("symptom.clinician.no_due")}
                </span>
                <Link className="font-medium text-brand-green underline" href={`/clinician/symptom-reviews?review=${r.id}`}>
                  {t("symptom.clinician.open")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail?.status === "denied" && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("symptom.clinician.denied")}</p>}

      {detail?.status === "ok" && detail.assessment && detail.review && (
        <section className={card} aria-label={t("symptom.clinician.checker_said")}>
          <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("symptom.clinician.checker_said")}</h2>
          <p className="text-sm text-charcoal-ink/80">
            {detail.patient?.name ?? "-"} ({detail.patient?.patient_number ?? "-"}
            {detail.patient?.age_years != null ? `, ${detail.patient.age_years}` : ""}
            {detail.patient?.sex ? `, ${detail.patient.sex}` : ""})
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-charcoal-ink/60">{t("symptom.clinician.complaint")}</dt>
            <dd>{detail.assessment.complaint.replace(/_/g, " ")}</dd>
            <dt className="text-charcoal-ink/60">{t("symptom.clinician.category")}</dt>
            <dd>{t(`symptom.clinician.cat.${detail.assessment.category}` as MessageKey)}</dd>
            <dt className="text-charcoal-ink/60">{t("symptom.clinician.why")}</dt>
            <dd>{detail.assessment.rationale}</dd>
            <dt className="text-charcoal-ink/60">{t("symptom.clinician.capture")}</dt>
            <dd>
              {[
                detail.assessment.capture.onset,
                detail.assessment.capture.severity != null ? `${detail.assessment.capture.severity}/10` : null,
                ...(detail.assessment.capture.associatedSymptoms ?? []).map(symptomOptionLabel),
                ...(detail.assessment.capture.triggers ?? []).map(symptomOptionLabel),
                ...(detail.assessment.capture.relevantHistory ?? []).map(symptomOptionLabel),
              ]
                .filter(Boolean)
                .join(", ")}
            </dd>
          </dl>
          <NotADiagnosis variant="short" />

          {detail.review.review_status === "completed" ? (
            <p role="status" className="border-t border-charcoal-ink/10 pt-3 text-sm">{t("symptom.clinician.form.done")}</p>
          ) : (
          <form action={completeSymptomReviewAction} className="space-y-3 border-t border-charcoal-ink/10 pt-3">
            <h3 className="text-sm font-semibold text-charcoal-ink">{t("symptom.clinician.form.title")}</h3>
            <input type="hidden" name="review" value={detail.review.id} />
            <label className="block text-sm">
              {t("symptom.clinician.form.code")}
              <input name="code" required minLength={3} maxLength={10} className={field} />
            </label>
            <label className="block text-sm">
              {t("symptom.clinician.form.label")}
              <input name="label" maxLength={200} className={field} />
            </label>
            <label className="block text-sm">
              {t("symptom.clinician.form.category")}
              <select name="category" required defaultValue={detail.assessment.category} className={field}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{t(`symptom.clinician.cat.${c}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="agrees" /> {t("symptom.clinician.form.agrees")}
            </label>
            <label className="block text-sm">
              {t("symptom.clinician.form.message")}
              <textarea name="message" required minLength={10} maxLength={600} rows={3} className={field} />
            </label>
            <label className="block text-sm">
              {t("symptom.clinician.form.note")}
              <textarea name="note" maxLength={2000} rows={2} className={field} />
            </label>
            <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">{t("symptom.clinician.form.submit")}</button>
          </form>
          )}
        </section>
      )}
    </div>
  );
}
