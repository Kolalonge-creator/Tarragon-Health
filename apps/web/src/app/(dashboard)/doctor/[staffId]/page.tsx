import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ClinicalStaffAvatar } from "@/components/clinical-staff-avatar";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatYearsOfExperience } from "@/lib/clinical/format-years-of-experience";

/**
 * The one place speciality, years of experience and bio are shown for a
 * doctor — founder decision 2026-09-25/2026-09-26 (docs/CLINICAL_TRUST_MODEL_SPEC.md):
 * every other attribution touchpoint (messages, timeline, escalations,
 * ask-a-doctor, second opinion, senior case review) links here via
 * DoctorNameLink instead of repeating this detail inline. Framed as "about
 * this doctor," never "your doctor" — see CLAUDE.md's no-continuous-
 * named-doctor correction; a viewer reaches this page because a specific
 * doctor did something (reviewed a case, sent a message), not because the
 * platform assigned them a standing doctor.
 *
 * Deliberately NOT under /patient/* — the shared attribution components
 * that link here (ReviewedByDoctor, PatientTimeline, ReviewedResultLine,
 * CareMessageThread) also render on /clinician/* pages, and proxy.ts's
 * role-home gate (isRoleHomePrefixed) redirects any non-patient,
 * non-admin role away from a /patient/* path. A bare /doctor/[staffId]
 * path matches no role-home prefix, so any authenticated role can reach it.
 *
 * No `active` filter: every staffId that can ever reach this page came from
 * a real reviewed_by/answered_by/actor record, which can only be set by a
 * clinical_staff row that was active at the time — clinical_staff cannot
 * act before verification/activation (docs/CLINICAL_TRUST_MODEL_SPEC.md §5).
 * A doctor who has since left is still a real person who did real reviews;
 * treating their profile as gone would 404 every historical attribution
 * that links here (5 of 7 call sites don't filter `active` on their own
 * embedded join, so they'd keep showing the name as a now-dead link).
 *
 * Selects only public-safe columns — never credential_type/credential_number,
 * staff_number, indemnity fields, etc. — even though clinical_staff's own RLS
 * (organisation_id = current_org_id()) is broader than this query needs; the
 * explicit organisation_id filter below is defense-in-depth on top of RLS,
 * per CLAUDE.md's "every table has organisation_id — always filter by it."
 */
export default async function DoctorProfilePage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const { staffId } = await params;
  const [supabase, viewer] = await Promise.all([createClient(), getCurrentProfile()]);

  if (!viewer?.organisation_id) notFound();

  const { data: doctor } = await supabase
    .from("clinical_staff")
    .select("full_name, photo_url, specialty, years_of_experience, bio")
    .eq("id", staffId)
    .eq("organisation_id", viewer.organisation_id)
    .maybeSingle();

  if (!doctor) notFound();

  const experience = formatYearsOfExperience(doctor.years_of_experience);

  return (
    <div className="space-y-6">
      <PageHeader title={`Dr. ${doctor.full_name}`} />
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
              A doctor at TarragonHealth.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
