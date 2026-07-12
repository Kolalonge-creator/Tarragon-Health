import { createClient } from "@/lib/supabase/server";

function formatReviewedDate(reviewedAt: string): string {
  return new Date(reviewedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The single shared "Reviewed by Dr. X" component — docs/CLINICAL_TRUST_MODEL_SPEC.md §2.
 * Null-gated: renders nothing unless escalations.reviewed_by AND reviewed_at
 * are both set (never invented, never set by anything other than the
 * reviewing doctor's own resolve action). If reviewed_by is set but no
 * matching clinical_staff record exists, falls back to a generic
 * clinician-attributed line rather than guessing a name — the guardrail
 * that makes false attribution structurally impossible.
 */
export async function ReviewedByDoctor({ escalationId }: { escalationId: string }) {
  const supabase = await createClient();

  const { data: escalation } = await supabase
    .from("escalations")
    .select("reviewed_by, reviewed_at, resolution_note")
    .eq("id", escalationId)
    .maybeSingle();

  if (!escalation?.reviewed_by || !escalation?.reviewed_at) {
    return null;
  }

  const { data: doctor } = await supabase
    .from("clinical_staff")
    .select("full_name, credential_type, credential_number")
    .eq("profile_id", escalation.reviewed_by)
    .eq("active", true)
    .maybeSingle();

  const reviewedDate = formatReviewedDate(escalation.reviewed_at);

  if (!doctor) {
    return (
      <p className="text-sm text-charcoal-ink/70">Reviewed by your care team · {reviewedDate}</p>
    );
  }

  const credential =
    doctor.credential_type && doctor.credential_number
      ? `${doctor.credential_type} ${doctor.credential_number}`
      : null;

  return (
    <p className="text-sm text-charcoal-ink">
      Reviewed by <span className="font-medium">Dr. {doctor.full_name}</span>
      {credential && <span className="text-charcoal-ink/60"> · {credential}</span>}
      <span className="text-charcoal-ink/60"> · {reviewedDate}</span>
      {escalation.resolution_note && (
        <span className="block text-charcoal-ink/70">{escalation.resolution_note}</span>
      )}
    </p>
  );
}
