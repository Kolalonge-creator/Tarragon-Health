import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { readOversightRoster, readThresholdHubState, type OversightRow } from "@/lib/queries/threshold-overrides";
import { reviewThresholdOverrideAction, withdrawThresholdPolicyAction } from "./actions";

export const metadata = { title: "Personal thresholds" };
export const dynamic = "force-dynamic";

function describeParams(r: OversightRow): string {
  const p = r.params as { target?: { systolic: number; diastolic: number }; lowAmberSystolic?: number; hypoAlertMmol?: number; hypoSevereMmol?: number };
  return [
    p.target && `target ${p.target.systolic}/${p.target.diastolic}`,
    p.lowAmberSystolic !== undefined && `low-reading line ${p.lowAmberSystolic}`,
    p.hypoAlertMmol !== undefined && `treat-now low ${p.hypoAlertMmol}`,
    p.hypoSevereMmol !== undefined && `red low ${p.hypoSevereMmol}`,
  ].filter(Boolean).join(", ");
}
const day = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" }) : "-");

/**
 * Chief Medical Officer only. Every live or recently ended personal threshold in the organisation, who proposed and signed it, when it returns to the default
 * and whether its monthly review is overdue. Opening this page is itself audited. A CMO account is `clinician` and cannot open /admin, so this lives here.
 */
export default async function ThresholdOverridesPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const supabase = await createClient();
  const [roster, state] = await Promise.all([readOversightRoster(supabase), readThresholdHubState(supabase)]);
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold text-charcoal-ink">Personal alert thresholds</h1>
      <p className="text-sm text-charcoal-ink/70">
        A senior doctor tied to a patient can set a personal threshold, signed by typing SIGN. It can calm two routine amber alerts or make a check more sensitive. It can never lower a red, relax a reading with a symptom,
        or apply in pregnancy, the six weeks after a birth or under 18. It returns to the default on its own when it expires.
      </p>
      {roster.failed || state.failed ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Part of this page could not be read. Do not treat what is shown as complete.</p> : null}
      <p className="text-sm text-charcoal-ink">
        Policy: <strong>{state.policyActive ? "signed and on" : "not on"}</strong>. Live thresholds: <strong>{state.active}</strong>. Reviews overdue: <strong>{state.reviewsOverdue}</strong>.
      </p>
      {state.policyActive ? (
        <form action={withdrawThresholdPolicyAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-charcoal-ink/15 p-3 text-sm">
          <label className="text-charcoal-ink">Switch every personal threshold off at once (they return if the policy is signed again). Reason
            <input name="reason" required minLength={5} className="mt-1 block w-72 rounded-lg border border-charcoal-ink/20 px-3 py-2" /></label>
          <button type="submit" className="rounded-lg border border-red-700 px-4 py-2 font-semibold text-red-800">Withdraw the policy</button>
        </form>
      ) : null}
      {roster.rows.length === 0 && !roster.failed ? <p className="text-sm text-charcoal-ink/70">No personal thresholds are set.</p> : null}
      <ul className="space-y-3">
        {roster.rows.map((r) => (
          <li key={r.id} className="space-y-2 rounded-lg border border-charcoal-ink/15 p-3 text-sm">
            <p className="font-medium text-charcoal-ink">
              {r.domain === "bp" ? "Blood pressure" : "Glucose"}: {describeParams(r)} <span className="rounded bg-charcoal-ink/10 px-1.5 py-0.5 text-xs">{r.status}</span>
              {r.reviewOverdue ? <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">review overdue</span> : null}
              {r.isTest ? <span className="ml-2 text-xs">(test patient)</span> : null}
            </p>
            <p className="text-charcoal-ink/70">Reason: {r.reason}</p>
            <p className="text-charcoal-ink/70">
              Proposed by {r.proposedBy ?? "-"}, signed by {r.signedBy ?? "not signed"} on {day(r.signedAt)}. Returns to the default {day(r.expiresAt)}. Review due {day(r.reviewDueAt)}. Grades it has changed: {r.appliedCount}.
              {r.endedAt ? ` Ended ${day(r.endedAt)}: ${r.endReason ?? ""}` : ""}
            </p>
            {r.status === "active" ? (
              <form action={reviewThresholdOverrideAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="override_id" value={r.id} />
                <label className="text-charcoal-ink">Review note<input name="note" required minLength={5} className="mt-1 block w-72 rounded-lg border border-charcoal-ink/20 px-3 py-2" /></label>
                <button type="submit" name="outcome" value="continue" className="rounded-lg bg-brand-green px-4 py-2 font-semibold text-white">Keep it</button>
                <button type="submit" name="outcome" value="revoke" className="rounded-lg border border-red-700 px-4 py-2 font-semibold text-red-800">End it</button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
