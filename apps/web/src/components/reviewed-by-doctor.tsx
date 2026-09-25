import { createClient } from "@/lib/supabase/server";
import { ClinicalStaffAvatar } from "@/components/clinical-staff-avatar";
import { DoctorNameLink } from "@/components/doctor-name-link";

function formatReviewedDate(reviewedAt: string): string {
  return new Date(reviewedAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

/**
 * The single shared "Reviewed by Dr. X" component — docs/CLINICAL_TRUST_MODEL_SPEC.md §2.
 * Null-gated: renders nothing unless escalations.reviewed_by AND reviewed_at
 * are both set (never invented, never set by anything other than the
 * reviewing doctor's own resolve action). If reviewed_by is set but no
 * matching clinical_staff record exists, falls back to a generic
 * clinician-attributed line rather than guessing a name — the guardrail
 * that makes false attribution structurally impossible. Photo is per-case
 * attribution only (this case's reviewer), never a standing "your doctor"
 * profile — see CLAUDE.md's no-continuous-named-doctor correction. The name
 * links to the doctor's profile page, which is the only place speciality and
 * years of experience are shown (founder decision 2026-09-25/2026-09-26 —
 * see doctor-name-link.tsx and doctor/[staffId]/page.tsx).
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
    .from("clinical_staff_directory")
    .select("id, full_name, photo_url")
    .eq("profile_id", escalation.reviewed_by)
    .eq("active", true)
    .maybeSingle();

  const reviewedDate = formatReviewedDate(escalation.reviewed_at);

  if (!doctor) {
    return (
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Reviewed by your care team · {reviewedDate}</p>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <ClinicalStaffAvatar fullName={doctor.full_name ?? ""} photoUrl={doctor.photo_url} />
      <p className="text-sm text-charcoal-ink dark:text-night-ink">
        Reviewed by{" "}
        <span className="font-medium">
          <DoctorNameLink staffId={doctor.id} fullName={doctor.full_name ?? ""} />
        </span>
        <span className="text-charcoal-ink/60 dark:text-night-ink/60"> · {reviewedDate}</span>
        {escalation.resolution_note && (
          <span className="block text-charcoal-ink/70 dark:text-night-ink/70">{escalation.resolution_note}</span>
        )}
      </p>
    </div>
  );
}
