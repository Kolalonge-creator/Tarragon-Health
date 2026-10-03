import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ClinicalStaffAvatar } from "@/components/clinical-staff-avatar";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatYearsOfExperience } from "@/lib/clinical/format-years-of-experience";

/**
 * The one place speciality, years of experience and bio are shown to a
 * patient — founder decision 2026-09-25/2026-09-26 (docs/CLINICAL_TRUST_MODEL_SPEC.md):
 * every other patient-facing touchpoint (messages, timeline, escalations,
 * ask-a-doctor, second opinion, senior case review) links here via
 * DoctorNameLink instead of repeating this detail inline. Framed as "about
 * this doctor," never "your doctor" — see CLAUDE.md's no-continuous-
 * named-doctor correction; a patient reaches this page because a specific
 * doctor did something (reviewed a case, sent a message), not because the
 * platform assigned them a standing doctor.
 *
 * Selects only public-safe columns — never credential_type/credential_number,
 * staff_number, indemnity fields, etc. — even though clinical_staff's own RLS
 * (organisation_id = current_org_id()) is broader than this query needs.
 */
export default async function DoctorProfilePage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = await params;
  const supabase = await createClient();

  const { data: doctor } = await supabase
    .from("clinical_staff")
    .select("full_name, photo_url, specialty, years_of_experience, bio")
    .eq("id", staffId)
    .eq("active", true)
    .maybeSingle();

  if (!doctor) notFound();

  const experience = formatYearsOfExperience(doctor.years_of_experience);

  return (
    <div className="space-y-6">
      <PageHeader title={`Dr. ${doctor.full_name}`} backTo={{ href: "/patient/messages", label: "Back" }} />
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-start">
          <ClinicalStaffAvatar fullName={doctor.full_name} photoUrl={doctor.photo_url} />
          <div className="space-y-2">
            <p className="text-lg font-medium text-charcoal-ink dark:text-night-ink">
              Dr. {doctor.full_name}
            </p>
            {(doctor.specialty || experience) && (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                {[doctor.specialty, experience].filter(Boolean).join(" · ")}
              </p>
            )}
            {doctor.bio && (
              <p className="whitespace-pre-wrap text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                {doctor.bio}
              </p>
            )}
            <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
              One of the doctors on your care team at TarragonHealth.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
