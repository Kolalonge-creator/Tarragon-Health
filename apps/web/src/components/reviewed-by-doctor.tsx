import { createClient } from "@/lib/supabase/server";
import { ReviewedResultLine } from "@/components/reviewed-result-line";

/**
 * The single shared "Reviewed by Dr. X" component for an escalation —
 * docs/CLINICAL_TRUST_MODEL_SPEC.md §2. A thin wrapper around
 * <ReviewedResultLine>: fetches the one thing that component doesn't already
 * have (the escalation's own reviewed_by/reviewed_at/resolution_note — its
 * other callers, lab_result_documents/annual_health_checks, already hold
 * that pair themselves) and hands off the doctor lookup, the null-gating,
 * and the "Reviewed by Dr. X · date" rendering to it. `avatar` gets the
 * per-case attribution photo (never a standing "your doctor" profile — see
 * CLAUDE.md's no-continuous-named-doctor correction); `note` appends the
 * resolution text, which only this call site has.
 */
export async function ReviewedByDoctor({ escalationId }: { escalationId: string }) {
  const supabase = await createClient();

  const { data: escalation } = await supabase
    .from("escalations")
    .select("reviewed_by, reviewed_at, resolution_note")
    .eq("id", escalationId)
    .maybeSingle();

  return (
    <ReviewedResultLine
      reviewedBy={escalation?.reviewed_by ?? null}
      reviewedAt={escalation?.reviewed_at ?? null}
      reviewedByKey="profile"
      avatar
      note={escalation?.resolution_note}
    />
  );
}
