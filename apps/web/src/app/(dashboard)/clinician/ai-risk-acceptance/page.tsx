import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { AI_RISK_SYSTEM_CODE, daysUntil, maxValidUntil, restrictionStatusSchema } from "@/lib/clinician/ai-risk-acceptance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignForm } from "./sign-form";

export const metadata = { title: "AI Health Coach risk acceptance" };
export const dynamic = "force-dynamic";

/** W-10, CMO only: whether the AI Health Coach is restricted to advisory display, the dated re-evaluation, and the signed risk acceptance. */
export default async function AiRiskAcceptancePage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");

  const supabase = loose(await createClient());
  const { data, error } = await supabase.rpc("ai_restriction_status", { p_system_code: AI_RISK_SYSTEM_CODE });
  const parsed = error ? null : restrictionStatusSchema.safeParse(data);
  const status = parsed?.success ? parsed.data : null;
  const now = new Date();
  const left = status ? daysUntil(status.reevaluation_due, now) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">AI Health Coach risk acceptance</h1>
        <p className="text-sm text-charcoal-ink/70">
          The coach can show advice to members, but while it is restricted it does not open clinician alerts on its own judgement. If no risk acceptance is
          signed within 30 days of the restriction, it switches itself off.
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
              <p>Mode: {status.restricted_mode === "advisory_only" ? "advisory display only" : "not restricted"}</p>
              {status.reevaluation_due && (
                <p>
                  Re-evaluation due: {status.reevaluation_due}
                  {left !== null && (left >= 0 ? ` (${left} days left)` : " (date passed)")}
                </p>
              )}
              {status.disabled_reason && <p>{status.disabled_reason}</p>}
              {status.acceptance ? (
                <p>Latest acceptance: signed {status.acceptance.accepted_at.slice(0, 10)}, valid until {status.acceptance.valid_until}. {status.acceptance.summary}</p>
              ) : (
                <p>No risk acceptance has been signed.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Sign a risk acceptance</CardTitle></CardHeader>
            <CardContent><SignForm maxDate={maxValidUntil(now)} /></CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
