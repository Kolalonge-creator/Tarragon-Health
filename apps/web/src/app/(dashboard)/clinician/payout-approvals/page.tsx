import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { formatKobo } from "@/lib/format-money";
import { approvalRowsSchema, buildApprovalModel, type ApprovalLoad } from "@/lib/payouts/approvals";
import { CmoApproveButton } from "@/components/payouts/cmo-approve-button";

export const metadata = { title: "Payout approvals" };
export const dynamic = "force-dynamic";

/**
 * S36j: the Chief Medical Officer's door to approve weekly payout drafts (founder decision 2026-10-06). A CMO's account role is
 * `clinician`, which can never open /admin, so the page lives here, gated by canAssignCases. Approval only; sending, discarding and
 * retrying stay on the admin page. The database checks the approver, the guard, the payee and the bank again.
 */
export default async function PayoutApprovalsPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const locale = DEFAULT_UI_LANGUAGE;
  const supabase = loose(await createClient());
  const [queue, guard] = await Promise.all([supabase.rpc("payout_approval_queue", {}), supabase.rpc("go_live_guard_is_open", { p_key: "payouts_enabled" })]);
  const parsed = queue.error ? null : approvalRowsSchema.safeParse(queue.data);
  const load: ApprovalLoad = parsed?.success ? { ok: true, rows: parsed.data } : { ok: false };
  const guardOpen = guard.error ? false : guard.data === true;
  const rows = load.ok ? buildApprovalModel(load.rows, guardOpen) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("payapprove.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("payapprove.intro", locale)}</p>
      </div>

      {!guardOpen && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{t("payapprove.off", locale)}</p>
      )}

      {!load.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("payapprove.load_error", locale)}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("payapprove.none", locale)}</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <div>
                <p className="font-medium text-charcoal-ink">{r.clinician_name ?? "A clinician"}</p>
                <p className="text-xs text-charcoal-ink/60">{t("payapprove.earnings", locale, { count: r.line_count, date: r.period_end })}</p>
                {r.blockedReason === "no_bank" && <p className="text-xs text-red-600">{t("payapprove.no_bank", locale)}</p>}
              </div>
              <div className="flex items-start gap-3">
                <span className="font-semibold text-charcoal-ink">{formatKobo(r.amount_kobo)}</span>
                <CmoApproveButton payoutId={r.id} disabled={!r.canApprove} label={t("payapprove.approve", locale)} workingLabel={t("payapprove.working", locale)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
