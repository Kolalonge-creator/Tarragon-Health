import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { AI_RISK_SYSTEM_CODE, maxValidUntil, restrictionStatusSchema } from "@/lib/clinician/ai-risk-acceptance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignForm } from "./sign-form";

export const metadata = { title: "AI Health Coach risk acceptance" };
export const dynamic = "force-dynamic";

/**
 * W-10, CMO only: whether the AI Health Coach is restricted, the countdown to the automatic switch-off, how often the restriction was lifted
 * or re-applied, whether the re-evaluation is overdue, and the signed risk acceptance. The database is the gate: a refusal (42501) sends the
 * visitor away, and the sign form only shows when the database says this caller can sign (the same CMO test as the signing function).
 */
export default async function AiRiskAcceptancePage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");

  const supabase = loose(await createClient());
  const { data, error } = await supabase.rpc("ai_restriction_status", { p_system_code: AI_RISK_SYSTEM_CODE });
  if (error?.code === "42501") redirect("/clinician");
  const parsed = error ? null : restrictionStatusSchema.safeParse(data);
  const status = parsed?.success ? parsed.data : null;
  const now = new Date();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">AI Health Coach risk acceptance</h1>
        <p className="text-sm text-charcoal-ink/70">
          While the coach is restricted, every answer it writes carries a short note, and questions about a member&apos;s own medicines, doses or results
          go to the care team. Clinician alerts are unchanged. If no risk acceptance is signed within 30 days of the restriction, the coach switches
          itself off.
        </p>
      </div>
      {!status ? (
        <p role="alert" className="text-sm text-red-600">We could not load the coach status. Please try again.</p>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>{status.name}</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Switched on: {status.enabled ? "yes" : "no"}</p>
              <p>Mode: {status.restricted_mode === "advisory_only" ? "restricted (answers carry a note)" : "not restricted"}</p>
              <p>Times the restriction was lifted or re-applied: {status.restriction_resets}</p>
              {status.restricted_mode === "advisory_only" && status.days_until_switch_off !== null && (
                <p>
                  Switches off on {status.switch_off_on} unless a risk acceptance is signed (
                  {status.days_until_switch_off >= 0 ? `${status.days_until_switch_off} days left` : "date passed"}).
                </p>
              )}
              {status.reevaluation_due && (
                <p>
                  Re-evaluation due: {status.reevaluation_due}
                  {status.reevaluation_overdue ? ". It is overdue: no completed evaluation run since the restriction." : ""}
                </p>
              )}
              {status.disabled_reason && <p>{status.disabled_reason}</p>}
              {status.acceptance ? (
                <p>
                  Latest acceptance: signed {status.acceptance.accepted_at.slice(0, 10)}, valid until {status.acceptance.valid_until}
                  {status.acceptance.no_rerun_yet ? " (no re-evaluation re-run yet)" : ""}. {status.acceptance.summary}
                </p>
              ) : (
                <p>No risk acceptance has been signed.</p>
              )}
            </CardContent>
          </Card>
          {status.can_sign && (
            <Card>
              <CardHeader><CardTitle>Sign a risk acceptance</CardTitle></CardHeader>
              <CardContent><SignForm maxDate={maxValidUntil(now, true)} maxDateNoRerun={maxValidUntil(now, false)} /></CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
