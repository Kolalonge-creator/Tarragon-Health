import { t } from "@tarragon/i18n";
import { logEmailTicketAction } from "@/lib/support-email/actions";
import { asNotice } from "@/lib/support-email/model";

const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/** S80d (25.4): staff paste an email and record it as a ticket. A person records it; nothing reads a mailbox. */
export function EmailForm({ notice }: { notice?: string }) {
  const n = asNotice(notice);
  const bad = n !== null && n !== "logged" && n !== "logged_clinical";
  return (
    <section aria-labelledby="email-log" className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card">
      <h2 id="email-log" className="font-heading text-lg font-semibold text-charcoal-ink">{t("supportemail.title", "en")}</h2>
      {n && (
        <p role={bad ? "alert" : "status"} className={`rounded-lg border p-2 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`supportemail.notice.${n}`, "en")}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("supportemail.open", "en")}</summary>
        <p className="mt-2 text-sm text-charcoal-ink/70">{t("supportemail.intro", "en")}</p>
        <form action={logEmailTicketAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-charcoal-ink">
            {t("supportemail.email", "en")}
            <input name="email" type="email" required className={field} />
          </label>
          <label className="block text-xs text-charcoal-ink">
            {t("supportemail.sender", "en")}
            <input name="sender" required minLength={3} maxLength={200} className={field} />
          </label>
          <label className="block text-xs text-charcoal-ink">
            {t("supportemail.priority", "en")}
            <select name="priority" defaultValue="normal" className={field}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="block text-xs text-charcoal-ink">
            {t("supportemail.subject", "en")}
            <input name="subject" required minLength={3} maxLength={120} className={field} />
          </label>
          <label className="block text-xs text-charcoal-ink sm:col-span-2">
            {t("supportemail.body", "en")}
            <textarea name="body" required minLength={10} maxLength={5000} rows={5} className={field} />
          </label>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink sm:col-span-2">
            <input type="checkbox" name="clinical" className="mt-1" />
            <span>{t("supportemail.clinical", "en")}</span>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
              {t("supportemail.submit", "en")}
            </button>
          </div>
        </form>
      </details>
    </section>
  );
}
