import { t, type Locale } from "@tarragon/i18n";
import { FlashClean } from "@/components/go-live/flash-clean";
import { formatKobo } from "@/lib/format-money";
import { cancelPayoutAction, approvePayoutAction, preparePayoutsAction } from "@/lib/payouts/actions";
import { loadPayouts, loadPayoutsGuard, loadUnpaid } from "@/lib/payouts/load";
import { asNotice, lastFullWeek, type PayoutRow, type Viewer } from "@/lib/payouts/model";

const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const STATE_STYLE: Record<PayoutRow["state"], string> = {
  draft: "bg-sky-100 text-sky-900",
  approved: "bg-emerald-100 text-emerald-900",
  sent: "bg-emerald-100 text-emerald-900",
  succeeded: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-900",
  reversed: "bg-amber-100 text-amber-900",
  cancelled: "bg-charcoal-ink/10 text-charcoal-ink",
};

/**
 * S36f: the payouts screen. `ops` prepares drafts and sees unpaid totals and can withdraw a draft; `admin` approves or cancels.
 * The Approve button is drawn only when the database says the caller may approve (an admin who did not prepare the draft), and the
 * database refuses everyone else whatever this page shows. There is no "send" control: sending money is a later piece, and the
 * state of the payouts_enabled guard is shown so nobody expects it. A failed load says so and is never shown as an empty list.
 */
export async function PayoutsView({ viewer, locale, notice }: { viewer: Viewer; locale: Locale; notice?: string }) {
  const [payouts, unpaid, guard] = await Promise.all([loadPayouts(), viewer === "ops" ? loadUnpaid() : Promise.resolve(null), loadPayoutsGuard()]);
  const n = asNotice(notice);
  const bad = n !== null && (n.endsWith("failed") || n === "same_person");
  const week = lastFullWeek(new Date());

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t(`payoutdraft.title.${viewer}`, locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t(`payoutdraft.intro.${viewer}`, locale)}</p>
      </div>

      {n && <FlashClean />}
      {n && (
        <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`payoutdraft.notice.${n}`, locale)}
        </p>
      )}

      <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        {guard === true ? t("payoutdraft.guard.on", locale) : guard === false ? t("payoutdraft.guard.off", locale) : t("payoutdraft.guard.unknown", locale)}
      </p>

      {viewer === "ops" && (
        <>
          <section aria-labelledby="unpaid" className="space-y-3">
            <div>
              <h2 id="unpaid" className="font-heading text-xl font-semibold text-charcoal-ink">{t("payoutdraft.unpaid.title", locale)}</h2>
              <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("payoutdraft.unpaid.intro", locale)}</p>
            </div>
            {!unpaid || !unpaid.ok ? (
              <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("payoutdraft.load_error", locale)}</p>
            ) : unpaid.data.length === 0 ? (
              <p className="text-sm text-charcoal-ink/70">{t("payoutdraft.unpaid.none", locale)}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-charcoal-ink/60">
                    <tr>
                      <th className="py-2 pr-4">{t("payoutdraft.unpaid.col.clinician", locale)}</th>
                      <th className="py-2 pr-4">{t("payoutdraft.unpaid.col.lines", locale)}</th>
                      <th className="py-2 pr-4">{t("payoutdraft.unpaid.col.total", locale)}</th>
                      <th className="py-2">{t("payoutdraft.unpaid.col.waiting", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unpaid.data.map((u) => (
                      <tr key={u.clinician_id} className="border-t border-charcoal-ink/10">
                        <td className="py-2 pr-4 font-medium text-charcoal-ink">{u.full_name ?? "-"}</td>
                        <td className="py-2 pr-4">{u.lines}</td>
                        <td className="py-2 pr-4">{formatKobo(u.unpaid_kobo)}</td>
                        <td className="py-2">{u.waiting_for_correction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="prepare" className="space-y-3">
            <h2 id="prepare" className="font-heading text-xl font-semibold text-charcoal-ink">{t("payoutdraft.prepare.title", locale)}</h2>
            <p className="max-w-3xl text-sm text-charcoal-ink/70">{t("payoutdraft.prepare.help", locale)}</p>
            <form action={preparePayoutsAction} className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-charcoal-ink">
                {t("payoutdraft.prepare.start", locale)}
                <input type="date" name="start" required defaultValue={week.start} className={field} />
              </label>
              <label className="text-xs text-charcoal-ink">
                {t("payoutdraft.prepare.end", locale)}
                <input type="date" name="end" required defaultValue={week.end} className={field} />
              </label>
              <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("payoutdraft.prepare.button", locale)}</button>
            </form>
          </section>
        </>
      )}

      <section aria-labelledby="payouts" className="space-y-3">
        <h2 id="payouts" className="font-heading text-xl font-semibold text-charcoal-ink">{t("payoutdraft.drafts.title", locale)}</h2>
        {!payouts.ok ? (
          <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("payoutdraft.load_error", locale)}</p>
        ) : payouts.data.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("payoutdraft.drafts.none", locale)}</p>
        ) : (
          <ul className="grid gap-3">
            {payouts.data.map((p) => (
              <li key={p.id} className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:border-night-ink/15 dark:bg-night-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-charcoal-ink">
                    {p.clinician_name ?? "-"} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_STYLE[p.state]}`}>{t(`payoutdraft.state.${p.state}`, locale)}</span>
                  </p>
                  <p className="font-semibold text-charcoal-ink">{formatKobo(p.amount_kobo)}</p>
                </div>
                <p className="text-charcoal-ink/70">
                  {day(p.period_start)} to {day(p.period_end)} · {p.line_count} {t("payoutdraft.drafts.col.lines", locale).toLowerCase()} · {t("payoutdraft.drafts.col.fee", locale)}{" "}
                  {p.fee_schedule_versions.length > 0 ? p.fee_schedule_versions.map((v) => `v${v}`).join(", ") : "-"} · {t("payoutdraft.drafts.col.prepared", locale)} {p.prepared_by_name ?? "-"}
                  {p.approved_by_name ? ` · ${t("payoutdraft.drafts.approved_by", locale)} ${p.approved_by_name}` : ""}
                </p>
                {p.approval_note && <p className="text-charcoal-ink/60">{p.approval_note}</p>}
                {p.cancel_reason && <p className="text-charcoal-ink/60">{p.cancel_reason}</p>}

                {viewer === "admin" && p.state === "draft" && p.can_approve === true && (
                  <form action={approvePayoutAction} className="space-y-2">
                    <input type="hidden" name="payout" value={p.id} />
                    <label className="block text-xs text-charcoal-ink">
                      {t("payoutdraft.approve.note", locale)}
                      <input name="note" required minLength={10} maxLength={1000} className={field} />
                    </label>
                    <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("payoutdraft.approve.button", locale)}</button>
                  </form>
                )}
                {viewer === "admin" && p.state === "draft" && p.can_approve !== true && <p className="text-xs text-charcoal-ink/70">{t("payoutdraft.approve.own", locale)}</p>}

                {((viewer === "admin" && (p.state === "draft" || p.state === "approved")) || (viewer === "ops" && p.state === "draft")) && (
                  <form action={cancelPayoutAction} className="space-y-2">
                    <input type="hidden" name="payout" value={p.id} />
                    <input type="hidden" name="viewer" value={viewer} />
                    <label className="block text-xs text-charcoal-ink">
                      {t("payoutdraft.cancel.reason", locale)}
                      <input name="reason" required minLength={10} maxLength={1000} className={field} />
                    </label>
                    <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("payoutdraft.cancel.button", locale)}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
