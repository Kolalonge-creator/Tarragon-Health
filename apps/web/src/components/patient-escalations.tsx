import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReviewedByDoctor } from "@/components/reviewed-by-doctor";
import type { EscalationStatus } from "@tarragon/shared";

// Patient-facing status copy — deliberately not the staff worklist labels
// (ESCALATION_STATUS_BADGE in lib/worklist/level-badge.ts uses "Unclaimed"
// etc.), per CLAUDE.md's brand voice rule: no clinical jargon, no
// fear-based urgency in patient-facing copy.
const PATIENT_STATUS_COPY: Record<EscalationStatus, string> = {
  open: "We're looking into this",
  under_review: "Being reviewed by your care team",
  resolved: "Reviewed",
  referred: "Referred for further care",
};

function formatDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Patient's own follow-up/escalation history — CLINICAL_TRUST_MODEL_SPEC.md
 * §2/§3 step 7 ("family dashboard shows the escalation event with the same
 * real attribution"). Renders nothing if the patient has no escalations on
 * record. Each row's doctor attribution is handled entirely by
 * ReviewedByDoctor, so this component never claims review on its own.
 */
export async function PatientEscalations({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  const { data: escalations } = await supabase
    .from("escalations")
    .select("id, reason, status, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (!escalations || escalations.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Care follow-ups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {escalations.map((escalation) => (
          <div
            key={escalation.id}
            className="space-y-1 border-b border-charcoal-ink/10 pb-4 last:border-0 last:pb-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm text-charcoal-ink">{escalation.reason}</p>
              <p className="shrink-0 text-xs text-charcoal-ink/50">
                {formatDate(escalation.created_at)}
              </p>
            </div>
            <p className="text-xs text-charcoal-ink/60">
              {PATIENT_STATUS_COPY[escalation.status]}
            </p>
            <ReviewedByDoctor escalationId={escalation.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
