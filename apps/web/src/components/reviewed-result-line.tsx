import { createClient } from "@/lib/supabase/server";

function formatReviewedDate(reviewedAt: string): string {
  return new Date(reviewedAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

/**
 * Null-gated "Reviewed by Dr. X" line for a reviewed_by/reviewed_at pair —
 * the same attribution discipline as <ReviewedByDoctor>
 * (docs/CLINICAL_TRUST_MODEL_SPEC.md §2), but driven directly by the pair
 * rather than an escalation id, so it works for any table with this shape
 * (lab_result_documents, annual_health_checks, ...). Renders nothing unless
 * BOTH are set (server-stamped, never invented). Falls back to a generic
 * care-team line when reviewed_by maps to no active clinical_staff record,
 * rather than guessing a name.
 *
 * `reviewedByKey` picks which column reviewed_by actually holds — the
 * codebase has two conventions in use (e.g. lab_result_documents.reviewed_by
 * references profiles.id, but annual_health_checks.reviewed_by and
 * medication_reviews.reviewed_by reference clinical_staff.id directly).
 * Defaults to "profile" to match the original callers.
 */
export async function ReviewedResultLine({
  reviewedBy,
  reviewedAt,
  reviewedByKey = "profile",
}: {
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewedByKey?: "profile" | "staff";
}) {
  if (!reviewedBy || !reviewedAt) return null;

  const supabase = await createClient();
  const { data: doctor } = await supabase
    .from("clinical_staff")
    .select("full_name, credential_type, credential_number")
    .eq(reviewedByKey === "staff" ? "id" : "profile_id", reviewedBy)
    .eq("active", true)
    .maybeSingle();

  const reviewedDate = formatReviewedDate(reviewedAt);

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
    </p>
  );
}
