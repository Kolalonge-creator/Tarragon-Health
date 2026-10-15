import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { loadAuditDetail, loadCaseFile } from "@/lib/quality/load";
import { asNotice, itemLabel, type AuditDetail, type CaseFile } from "@/lib/quality/model";
import { submitAuditAction } from "@/lib/quality/actions";

export const metadata = { title: "Audit", robots: { index: false, follow: false } };
// The case file is clinical content read through an audited read: never cached, never static.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const card = "rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:border-night-ink/15 dark:bg-night-card";

const show = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));

/** A small key and value list for a block of clinical content. Empty values are left out, never shown as a dash that could pass for "normal". */
function Facts({ title, data }: { title: string; data: Record<string, unknown> | null | undefined }) {
  const rows = Object.entries(data ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (rows.length === 0) return null;
  return (
    <section className={card}>
      <h2 className="font-heading text-base font-semibold text-charcoal-ink">{title}</h2>
      <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2"><dt className="w-36 shrink-0 text-charcoal-ink/60">{itemLabel(k)}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-charcoal-ink">{show(v)}</dd></div>
        ))}
      </dl>
    </section>
  );
}

function ClinicalContent({ file, locale }: { file: CaseFile; locale: "en" }) {
  const { task, patient } = file;
  const outcome = task.outcome && typeof task.outcome === "object" ? (task.outcome as Record<string, unknown>) : task.outcome ? { outcome: task.outcome } : null;
  return (
    <div className="space-y-4">
      <section className={card}>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {([
            [t("leadquality.patient.ref", locale), patient?.ref ?? null],
            [t("leadquality.patient.age", locale), patient?.age_band ?? null],
            [t("leadquality.task.type", locale), task.type ? itemLabel(task.type) : null],
            [t("leadquality.task.priority", locale), task.priority_class === null ? null : String(task.priority_class)],
            [t("leadquality.task.created", locale), lagos(task.created_at)],
            [t("leadquality.task.completed", locale), lagos(task.completed_at)],
            [t("leadquality.task.handbacks", locale), task.handback_count === null ? null : String(task.handback_count)],
            [t("leadquality.audit.reason", locale), itemLabel(file.audit.reason)],
            [t("leadquality.audit.due", locale), lagos(file.audit.due_at)],
          ] as const).map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="w-36 shrink-0 text-charcoal-ink/60">{k}</dt><dd className="text-charcoal-ink">{v ?? "-"}</dd></div>
          ))}
        </dl>
      </section>
      <Facts title={t("leadquality.case.outcome", locale)} data={outcome} />
      <Facts title={t("leadquality.case.trigger", locale)} data={file.trigger} />
      <Facts title={t("leadquality.case.reading", locale)} data={file.reading} />
      {file.messages && file.messages.length > 0 && (
        <section className={card}>
          <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("leadquality.case.messages", locale)}</h2>
          <ul className="mt-2 space-y-2">
            {file.messages.map((m, i) => (
              <li key={i}>
                <span className="font-medium text-charcoal-ink">{m.from === "patient" ? t("leadquality.case.from_patient", locale) : m.by_audited_clinician ? t("leadquality.case.from_audited", locale) : t("leadquality.case.from_team", locale)}</span>
                <span className="ml-2 text-xs text-charcoal-ink/60">{lagos(m.at)}</span>
                <p className="whitespace-pre-wrap text-charcoal-ink">{m.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {file.scribe_note && <Facts title={t("leadquality.case.scribe_note", locale)} data={file.scribe_note} />}
    </div>
  );
}

function Finished({ detail, locale }: { detail: AuditDetail; locale: "en" }) {
  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("leadquality.finished.result", locale)}</h2>
        <p className="mt-1 text-charcoal-ink">
          {itemLabel(detail.final_outcome ?? detail.outcome ?? "")} {detail.total_score !== null ? `(${detail.total_score})` : ""}
          {detail.second_review_required ? ` · ${t(detail.second_review_agrees === false ? "leadquality.second.disagreed" : "leadquality.second.agreed", locale)}` : ""}
        </p>
        {detail.rationale && <p className="mt-2 whitespace-pre-wrap text-charcoal-ink/80">{detail.rationale}</p>}
        {detail.avoidability && <p className="mt-2 text-charcoal-ink/80">{t("leadquality.form.avoidability", locale)}: {itemLabel(detail.avoidability)}</p>}
      </section>
      <Facts title={t("leadquality.form.phases", locale)} data={detail.phase_comments} />
      <Facts title={t("leadquality.form.scribe", locale)} data={detail.scribe_results ? Object.fromEntries(Object.entries(detail.scribe_results).map(([k, v]) => [k, v ? t("leadquality.form.pass", locale) : t("leadquality.form.fail", locale)])) : null} />
      <section className={card}>
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("leadquality.finished.replies", locale)}</h2>
        {detail.replies.length === 0 ? <p className="mt-1 text-charcoal-ink/70">{t("leadquality.finished.no_replies", locale)}</p> : (
          <ul className="mt-2 space-y-2">{detail.replies.map((r, i) => <li key={i}><span className="text-xs text-charcoal-ink/60">{lagos(r.at)}</span><p className="whitespace-pre-wrap text-charcoal-ink">{r.body}</p></li>)}</ul>
        )}
      </section>
      <section className={card}>
        <h2 className="font-heading text-base font-semibold text-charcoal-ink">{t("leadquality.finished.followups", locale)}</h2>
        {detail.followups.length === 0 ? <p className="mt-1 text-charcoal-ink/70">{t("leadquality.finished.no_followups", locale)}</p> : (
          <ul className="mt-2 space-y-2">{detail.followups.map((f, i) => <li key={i}><span className="text-xs text-charcoal-ink/60">{t(f.kind === "closed" ? "leadquality.finished.closed" : "leadquality.finished.note", locale)} · {lagos(f.at)}</span><p className="whitespace-pre-wrap text-charcoal-ink">{f.note}</p></li>)}</ul>
        )}
      </section>
    </div>
  );
}

/**
 * S36c and S20 v2: one audit. Opening an unfinished audit is an audited clinical read (INV-10, audit_case_file): who opened it and when is
 * recorded, and the database refuses a score from anyone who did not open it. The patient is a pseudonymous reference and an age, never a
 * name or id. A critical miss waits here for a second, independent reader, who reads the case without seeing the first reading. A finished
 * audit shows its scores, replies and follow-up history, and does not read the clinical record again.
 */
export default async function AuditPage({ params, searchParams }: { params: Promise<{ auditId: string }>; searchParams: Promise<{ n?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician/quality");
  const { auditId } = await params;
  if (!z.string().uuid().safeParse(auditId).success) notFound();
  const locale = DEFAULT_UI_LANGUAGE;
  const notice = asNotice((await searchParams).n);
  const detail = await loadAuditDetail(auditId);
  const isFinished = detail.ok && detail.data.state === "submitted" && (!detail.data.second_review_required || detail.data.final_outcome !== null);

  const header = (
    <div>
      <Link href="/clinician/quality" className="text-sm underline">{t("leadquality.back", locale)}</Link>
      <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-charcoal-ink">{t("leadquality.audit.title", locale)}</h1>
    </div>
  );

  if (isFinished && detail.ok) {
    return <div className="max-w-3xl space-y-6">{header}<Finished detail={detail.data} locale={locale} /></div>;
  }

  const file = await loadCaseFile(auditId);
  if (!file.ok) {
    return (
      <div className="max-w-3xl space-y-4">
        {header}
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t(file.denied ? "leadquality.audit.denied" : "leadquality.load_error", locale)}</p>
      </div>
    );
  }
  const { audit, form } = file.data;
  const second = audit.opened_as === "second";
  const scribe = audit.scribe_assisted === true && (form.scribe_items?.length ?? 0) > 0;

  return (
    <div className="max-w-3xl space-y-6">
      {header}
      <p className="text-sm text-charcoal-ink/70">{t("leadquality.audit.logged", locale)}</p>
      {second && <p className="rounded-xl border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900">{t("leadquality.second.banner", locale)}</p>}
      {notice === "audit_incomplete" && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{t("leadquality.notice.audit_incomplete", locale)}</p>}
      {notice === "audit_failed" && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{t("leadquality.notice.audit_failed", locale)}</p>}

      <ClinicalContent file={file.data} locale={locale} />

      <form action={submitAuditAction} className="space-y-6">
        <input type="hidden" name="audit" value={audit.id} />
        <input type="hidden" name="form" value={JSON.stringify(form)} />
        <input type="hidden" name="mode" value={second ? "second" : "first"} />
        {scribe && <input type="hidden" name="scribe_assisted" value="yes" />}
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
        {scribe && form.scribe_items && (
          <fieldset className="space-y-3">
            <legend className="font-heading text-lg font-semibold text-charcoal-ink">{t("leadquality.form.scribe", locale)}</legend>
            <p className="text-xs text-charcoal-ink/70">{t("leadquality.form.scribe_hint", locale)}</p>
            {form.scribe_items.map((item) => (
              <div key={item} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-charcoal-ink/5 px-3 py-2 text-sm">
                <span className="text-charcoal-ink">{itemLabel(item)}</span>
                <span className="flex gap-4">
                  <label className="flex items-center gap-1"><input type="radio" name={`scribe:${item}`} value="pass" required /> {t("leadquality.form.pass", locale)}</label>
                  <label className="flex items-center gap-1"><input type="radio" name={`scribe:${item}`} value="fail" required /> {t("leadquality.form.fail", locale)}</label>
                </span>
              </div>
            ))}
          </fieldset>
        )}
        {form.phases && form.phases.length > 0 && (
          <fieldset className="space-y-3">
            <legend className="font-heading text-lg font-semibold text-charcoal-ink">{t("leadquality.form.phases", locale)}</legend>
            <p className="text-xs text-charcoal-ink/70">{t("leadquality.form.phases_hint", locale)}</p>
            {form.phases.map((phase) => (
              <label key={phase} className="block text-sm text-charcoal-ink">
                {itemLabel(phase)}
                <textarea name={`phase:${phase}`} rows={2} maxLength={form.phase_comment_max_chars ?? 2000} className={field} />
              </label>
            ))}
          </fieldset>
        )}
        {!second && form.avoidability && (
          <label className="block text-sm font-medium text-charcoal-ink">
            {t("leadquality.form.avoidability", locale)}
            <select name="avoidability" defaultValue="" className={field}>
              <option value="">-</option>
              {form.avoidability.scale.map((o) => <option key={o} value={o}>{itemLabel(o)}</option>)}
            </select>
            <span className="mt-1 block text-xs font-normal text-charcoal-ink/60">{t("leadquality.form.avoidability_hint", locale)}</span>
          </label>
        )}
        <label className="block text-sm font-medium text-charcoal-ink">
          {t("leadquality.form.rationale", locale)}
          <textarea name="rationale" rows={4} maxLength={2000} required={second} className={field} />
          <span className="mt-1 block text-xs font-normal text-charcoal-ink/60">{t(second ? "leadquality.second.rationale_hint" : "leadquality.form.rationale_hint", locale)}</span>
        </label>
        <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">{t(second ? "leadquality.second.submit" : "leadquality.form.submit", locale)}</button>
      </form>
    </div>
  );
}
