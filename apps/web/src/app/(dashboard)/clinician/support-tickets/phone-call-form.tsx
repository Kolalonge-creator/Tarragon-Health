import { t } from "@tarragon/i18n";
import { logPhoneTicketAction } from "@/lib/support-phone/actions";
import { asNotice } from "@/lib/support-phone/model";

const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/** S80 (S-23): staff log a phone call as a ticket. A call about symptoms or medicines is flagged clinical and also reaches the care team's review list. */
export function PhoneCallForm({ notice }: { notice?: string }) {
  const n = asNotice(notice);
  const bad = n !== null && n !== "logged" && n !== "logged_clinical";
  return (
    <section aria-labelledby="phone-call" className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card">
      <h2 id="phone-call" className="font-heading text-lg font-semibold text-charcoal-ink">{t("supportphone.title", "en")}</h2>
      {n && (
        <p role={bad ? "alert" : "status"} className={`rounded-lg border p-2 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`supportphone.notice.${n}`, "en")}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("supportphone.open", "en")}</summary>
        <form action={logPhoneTicketAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-charcoal-ink">
            {t("supportphone.phone", "en")}
            <input name="phone" required inputMode="tel" placeholder="+2348012345678" className={field} />
          </label>
          <label className="block text-xs text-charcoal-ink">
            {t("supportphone.priority", "en")}
            <select name="priority" defaultValue="normal" className={field}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="block text-xs text-charcoal-ink sm:col-span-2">
            {t("supportphone.subject", "en")}
            <input name="subject" required minLength={3} maxLength={120} className={field} />
          </label>
          <label className="block text-xs text-charcoal-ink sm:col-span-2">
            {t("supportphone.description", "en")}
            <textarea name="description" required minLength={10} maxLength={2000} rows={3} className={field} />
          </label>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink sm:col-span-2">
            <input type="checkbox" name="clinical" className="mt-1" />
            <span>{t("supportphone.clinical", "en")}</span>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-lg bg-brand-green px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
              {t("supportphone.submit", "en")}
            </button>
          </div>
        </form>
      </details>
    </section>
  );
}
