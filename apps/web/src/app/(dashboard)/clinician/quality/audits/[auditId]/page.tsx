import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { loadCaseFile } from "@/lib/quality/load";
import { asNotice, itemLabel } from "@/lib/quality/model";
import { submitAuditAction } from "@/lib/quality/actions";

export const metadata = { title: "Audit" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/**
 * S36c: one audit. Opening it is a logged clinical read (INV-10, audit_case_file), refused for the audited clinician's own work and
 * for another reviewer's audit. The page shows what the task was and when, never the patient's identity, and the form is the CMO's own
 * stored form: the score and outcome are computed by the database, not here.
 */
export default async function AuditPage({ params, searchParams }: { params: Promise<{ auditId: string }>; searchParams: Promise<{ n?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const { auditId } = await params;
  if (!z.string().uuid().safeParse(auditId).success) notFound();
  const profile = await getCurrentProfile();
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asNotice((await searchParams).n);
  const file = await loadCaseFile(auditId);

  if (!file.ok) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t(file.denied ? "leadquality.audit.denied" : "leadquality.load_error", locale)}</p>
        <Link href="/clinician/quality" className="text-sm underline">{t("leadquality.back", locale)}</Link>
      </div>
    );
  }
  const { audit, form, task } = file.data;
  const submitted = audit.state === "submitted" || audit.state === "closed";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/clinician/quality" className="text-sm underline">{t("leadquality.back", locale)}</Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-charcoal-ink">{t("leadquality.audit.title", locale)}</h1>
        <p className="mt-1 text-sm text-charcoal-ink/70">{t("leadquality.audit.logged", locale)}</p>
      </div>
      {notice === "audit_incomplete" && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{t("leadquality.notice.audit_incomplete", locale)}</p>}
      {notice === "audit_failed" && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{t("leadquality.notice.audit_failed", locale)}</p>}

      <dl className="grid gap-x-6 gap-y-1 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm sm:grid-cols-2 dark:border-night-ink/15 dark:bg-night-card">
        {([
          [t("leadquality.task.type", locale), task.type ? itemLabel(task.type) : null],
          [t("leadquality.task.priority", locale), task.priority_class === null ? null : String(task.priority_class)],
          [t("leadquality.task.created", locale), lagos(task.created_at)],
          [t("leadquality.task.completed", locale), lagos(task.completed_at)],
          [t("leadquality.task.handbacks", locale), task.handback_count === null ? null : String(task.handback_count)],
          [t("leadquality.task.outcome", locale), task.outcome ? itemLabel(task.outcome) : null],
          [t("leadquality.audit.reason", locale), itemLabel(audit.reason)],
          [t("leadquality.audit.due", locale), lagos(audit.due_at)],
        ] as const).map(([k, v]) => (
          <div key={k} className="flex gap-2"><dt className="w-32 shrink-0 text-charcoal-ink/60">{k}</dt><dd className="text-charcoal-ink">{v ?? "-"}</dd></div>
        ))}
      </dl>

      {submitted ? (
        <p className="text-sm text-charcoal-ink/70">{t("leadquality.audit.already", locale)}</p>
      ) : (
        <form action={submitAuditAction} className="space-y-6">
          <input type="hidden" name="audit" value={audit.id} />
          <input type="hidden" name="form" value={JSON.stringify(form)} />
          <fieldset className="space-y-3">
            <legend className="font-heading text-lg font-semibold text-charcoal-ink">{t("leadquality.form.safety", locale)}</legend>
            <p className="text-xs text-charcoal-ink/70">{t("leadquality.form.safety_hint", locale)}</p>
            {form.safety_items.map((item) => (
              <div key={item} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-charcoal-ink/5 px-3 py-2 text-sm">
                <span className="text-charcoal-ink">{itemLabel(item)}</span>
                <span className="flex gap-4">
                  <label className="flex items-center gap-1"><input type="radio" name={`safety:${item}`} value="pass" required /> {t("leadquality.form.pass", locale)}</label>
                  <label className="flex items-center gap-1"><input type="radio" name={`safety:${item}`} value="fail" required /> {t("leadquality.form.fail", locale)}</label>
                </span>
              </div>
            ))}
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="font-heading text-lg font-semibold text-charcoal-ink">{t("leadquality.form.quality", locale)}</legend>
            <p className="text-xs text-charcoal-ink/70">{t("leadquality.form.quality_hint", locale, { max: form.quality_max })}</p>
            {form.quality_items.map((item) => (
              <label key={item} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-charcoal-ink/5 px-3 py-2 text-sm">
                <span className="text-charcoal-ink">{itemLabel(item)}</span>
                <select name={`quality:${item}`} required defaultValue="" className="rounded-lg border border-charcoal-ink/20 bg-white px-2 py-1 text-sm">
                  <option value="" disabled>-</option>
                  {Array.from({ length: form.quality_max + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            ))}
          </fieldset>
          <label className="block text-sm font-medium text-charcoal-ink">
            {t("leadquality.form.rationale", locale)}
            <textarea name="rationale" rows={4} maxLength={2000} className={field} />
            <span className="mt-1 block text-xs font-normal text-charcoal-ink/60">{t("leadquality.form.rationale_hint", locale)}</span>
          </label>
          <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">{t("leadquality.form.submit", locale)}</button>
        </form>
      )}
    </div>
  );
}
