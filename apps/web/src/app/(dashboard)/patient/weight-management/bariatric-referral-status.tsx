import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { formatPatientDate } from "@/lib/format-date";
/**
 * Patient-facing bariatric-referral status, mirroring ObesitySummary's
 * conventions: null-gated on an existing row (renders nothing otherwise),
 * doctor-set fields only, no software verdict. Unlike the ED screen (which
 * stays clinician-only — its consequence to the patient is the programme
 * pause already shown by ConditionEnrollmentCard, not a raw screen result),
 * a referral is a forward-looking care action worth surfacing directly, the
 * same way other specialist referrals are visible to a patient.
 */
const STATUS_COPY: Record<string, string> = {
  proposed: "Your care team has proposed a specialist assessment.",
  referred: "You've been referred for a specialist assessment.",
  workup: "Your work-up for the specialist assessment is in progress.",
  scheduled: "Your specialist appointment is scheduled.",
  completed: "Your specialist assessment is complete.",
  declined: "This referral was declined.",
  not_eligible: "This wasn't a fit right now, based on your current assessment.",
};

export async function BariatricReferralStatus({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bariatric_referrals")
    .select("status, referred_at")
    .eq("patient_id", patientId)
    .order("referred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Specialist assessment</CardTitle>
        <Badge variant={data.status === "completed" ? "green" : "blue"}>{data.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-charcoal-ink/80">
          {STATUS_COPY[data.status] ?? "Your care team is coordinating a specialist assessment."}
        </p>
        <p className="text-xs text-charcoal-ink/60">
          Raised {formatPatientDate(data.referred_at)}. Questions about this are
          welcome, your care team can walk you through what happens next.
        </p>
      </CardContent>
    </Card>
  );
}
