import { createClient } from "@/lib/supabase/server";
import { DoctorNameLink } from "@/components/doctor-name-link";
import { ClinicalStaffAvatar } from "@/components/clinical-staff-avatar";
import { formatPatientDate } from "@/lib/format-date";
import { DOCTOR_ATTRIBUTION_FIELDS } from "@/lib/queries/clinical-staff";

function CareTeamFallback({ reviewedDate }: { reviewedDate: string }) {
  return (
    <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Reviewed by your care team · {reviewedDate}</p>
  );
}

function ReviewedLine({
  doctorId,
  fullName,
  reviewedDate,
  note,
}: {
  doctorId: string;
  fullName: string;
  reviewedDate: string;
  note?: string | null;
}) {
  return (
    <p className="text-sm text-charcoal-ink dark:text-night-ink">
      Reviewed by{" "}
      <span className="font-medium">
        <DoctorNameLink staffId={doctorId} fullName={fullName} />
      </span>
      <span className="text-charcoal-ink/60 dark:text-night-ink/60"> · {reviewedDate}</span>
      {note && <span className="block text-charcoal-ink/70 dark:text-night-ink/70">{note}</span>}
    </p>
  );
}

/**
 * Null-gated "Reviewed by Dr. X" line for a reviewed_by/reviewed_at pair —
 * the same attribution discipline as <ReviewedByDoctor>
 * (docs/CLINICAL_TRUST_MODEL_SPEC.md §2), but driven directly by the pair
 * rather than an escalation id, so it works for any table with this shape
 * (lab_result_documents, annual_health_checks, ...). Renders nothing unless
 * BOTH are set (server-stamped, never invented). Falls back to a generic
 * care-team line when reviewed_by maps to no active clinical_staff record,
 * rather than guessing a name. The name links to the doctor's profile page —
 * speciality/years of experience live there only, not inline here.
 *
 * `reviewedByKey` picks which column reviewed_by actually holds — the
 * codebase has two conventions in use (e.g. lab_result_documents.reviewed_by
 * references profiles.id, but annual_health_checks.reviewed_by and
 * medication_reviews.reviewed_by reference clinical_staff.id directly).
 * Defaults to "profile" to match the original callers.
 *
 * `avatar` and `note` exist so <ReviewedByDoctor> — which needs a
 * ClinicalStaffAvatar plus the escalation's own resolution_note appended
 * below the date — can be a thin wrapper around this component instead of
 * duplicating its lookup + null-gated rendering. Neither prop is passed by
 * the original callers (lab_result_documents, annual_health_checks), so
 * their rendering is byte-for-byte unchanged. `photo_url` is only ever
 * selected on the `avatar` path: several of the plain callers render this
 * inside a per-document/per-order `.map()` (e.g. imaging-orders-section.tsx,
 * result-documents-section.tsx), so fetching an unused column on every row
 * would be real, if small, waste rather than the "harmless" tradeoff an
 * earlier version of this comment claimed. If a third caller ever needs a
 * materially different render shape, give it its own composition of the
 * shared `clinical_staff` lookup below rather than adding a third prop here.
 */
export async function ReviewedResultLine({
  reviewedBy,
  reviewedAt,
  reviewedByKey = "profile",
  avatar = false,
  note,
}: {
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewedByKey?: "profile" | "staff";
  avatar?: boolean;
  note?: string | null;
}) {
  if (!reviewedBy || !reviewedAt) return null;

  const supabase = await createClient();
  const column = reviewedByKey === "staff" ? "id" : "profile_id";
  const reviewedDate = formatPatientDate(reviewedAt, { day: "numeric", month: "short" });

  if (avatar) {
    const { data: doctor } = await supabase
      .from("clinical_staff")
      .select(`${DOCTOR_ATTRIBUTION_FIELDS}, photo_url`)
      .eq(column, reviewedBy)
      .eq("active", true)
      .maybeSingle();

    if (!doctor) return <CareTeamFallback reviewedDate={reviewedDate} />;

    return (
      <div className="flex items-start gap-3">
        <ClinicalStaffAvatar fullName={doctor.full_name} photoUrl={doctor.photo_url} />
        <ReviewedLine doctorId={doctor.id} fullName={doctor.full_name} reviewedDate={reviewedDate} note={note} />
      </div>
    );
  }

  const { data: doctor } = await supabase
    .from("clinical_staff")
    .select(DOCTOR_ATTRIBUTION_FIELDS)
    .eq(column, reviewedBy)
    .eq("active", true)
    .maybeSingle();

  if (!doctor) return <CareTeamFallback reviewedDate={reviewedDate} />;

  return <ReviewedLine doctorId={doctor.id} fullName={doctor.full_name} reviewedDate={reviewedDate} note={note} />;
}
