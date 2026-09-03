import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DOMAIN_LABEL,
  FALLS_PATHWAY_STAGE_LABEL,
  FALLS_RISK_LEVEL_LABEL,
  HOME_CARE_STATUS_LABEL,
  OUTCOME_COPY,
} from "@/lib/healthy-ageing/types";
import { AgeingDomainReviewForm } from "./ageing-domain-review-form";
import { FallsRiskProgressForm } from "./falls-risk-progress-form";
import { SocialDeterminantFollowUpForm } from "./social-determinant-follow-up-form";
import { HomeCareRequestManagementForm } from "./home-care-request-management-form";

/**
 * The clinical-side counterpart to the patient's Healthy Ageing section —
 * pending review queues only, not a duplicate of the patient's own record.
 * Falls-pathway progression and clinical review are gated to clinical tier
 * (clinical judgment); social-determinant follow-up and home-visit
 * logistics are open to any org staff, matching the Care Coordinator's real
 * job (booking, navigation, check-ins — never clinical judgment).
 */
export async function HealthyAgeingClinicianPanel({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const staff = await getCurrentClinicalStaff();
  const clinical = isClinicalTier(staff);

  const [{ data: pendingDomains }, { data: openFalls }, { data: pendingSocial }, { data: openHomeCare }] =
    await Promise.all([
      supabase
        .from("ageing_assessment_domain_results")
        .select("id, domain, outcome, notes, assessment_id, ageing_assessments!inner(patient_id)")
        .eq("ageing_assessments.patient_id", patientId)
        .is("clinician_reviewed_at", null)
        .neq("outcome", "no_concern"),
      supabase
        .from("falls_risk_assessments")
        .select("id, risk_level, pathway_stage, previous_falls_12mo, mobility_impairment, high_risk_medications, environmental_hazards, balance_concern")
        .eq("patient_id", patientId)
        .neq("pathway_stage", "resolved")
        .order("identified_at", { ascending: false })
        .limit(1),
      supabase
        .from("social_determinant_screenings")
        .select("id, living_alone, transport_difficulty, financial_barrier, caregiver_limitation, healthcare_access_difficulty, follow_up_status, coordinator_notes")
        .eq("patient_id", patientId)
        .eq("follow_up_status", "pending"),
      supabase
        .from("home_care_requests")
        .select("id, reason, status, eligibility_notes")
        .eq("patient_id", patientId)
        .not("status", "in", "(visit_completed,declined)"),
    ]);

  const nothingPending =
    (pendingDomains?.length ?? 0) === 0 &&
    (openFalls?.length ?? 0) === 0 &&
    (pendingSocial?.length ?? 0) === 0 &&
    (openHomeCare?.length ?? 0) === 0;

  if (nothingPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Healthy ageing</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">Nothing pending review right now.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {(pendingDomains?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ageing check-in: flagged sections</CardTitle>
            <CardDescription>
              Answers that suggest a closer look. Reviewing records that a clinician looked at it, not a
              diagnosis.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingDomains!.map((d) => (
              <div key={d.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-charcoal-ink">{DOMAIN_LABEL[d.domain]}</p>
                  <Badge variant="blue">{OUTCOME_COPY[d.outcome]}</Badge>
                </div>
                {d.notes && <p className="mt-1 text-xs text-charcoal-ink/60">&ldquo;{d.notes}&rdquo;</p>}
                {clinical ? (
                  <AgeingDomainReviewForm domainResultId={d.id} />
                ) : (
                  <p className="mt-1 text-xs text-charcoal-ink/50">Only clinical staff can record a review.</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {openFalls && openFalls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Falls-risk pathway</CardTitle>
            <CardDescription>{FALLS_PATHWAY_STAGE_LABEL[openFalls[0].pathway_stage]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {openFalls[0].risk_level && (
                <Badge variant="amber">{FALLS_RISK_LEVEL_LABEL[openFalls[0].risk_level]} risk</Badge>
              )}
              {openFalls[0].previous_falls_12mo && <Badge variant="grey">Previous fall</Badge>}
              {openFalls[0].mobility_impairment && <Badge variant="grey">Mobility impairment</Badge>}
              {openFalls[0].high_risk_medications && <Badge variant="grey">High-risk medication</Badge>}
              {openFalls[0].environmental_hazards && <Badge variant="grey">Home hazard</Badge>}
              {openFalls[0].balance_concern && <Badge variant="grey">Balance concern</Badge>}
            </div>
            {clinical ? (
              <FallsRiskProgressForm fallsRiskId={openFalls[0].id} currentStage={openFalls[0].pathway_stage} />
            ) : (
              <p className="text-xs text-charcoal-ink/50">Only clinical staff can progress this pathway.</p>
            )}
          </CardContent>
        </Card>
      )}

      {pendingSocial && pendingSocial.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Support &amp; navigation follow-up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingSocial.map((s) => (
              <div key={s.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                <div className="flex flex-wrap gap-1.5">
                  {s.living_alone && <Badge variant="grey">Lives alone</Badge>}
                  {s.transport_difficulty && <Badge variant="grey">Transport difficulty</Badge>}
                  {s.financial_barrier && <Badge variant="grey">Financial barrier</Badge>}
                  {s.caregiver_limitation && <Badge variant="grey">Caregiver limitation</Badge>}
                  {s.healthcare_access_difficulty && <Badge variant="grey">Access difficulty</Badge>}
                </div>
                <SocialDeterminantFollowUpForm screeningId={s.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {openHomeCare && openHomeCare.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Home visit requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {openHomeCare.map((r) => (
              <div key={r.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                <p className="text-sm text-charcoal-ink">{r.reason}</p>
                <p className="mt-0.5 text-xs text-charcoal-ink/60">{HOME_CARE_STATUS_LABEL[r.status]}</p>
                <HomeCareRequestManagementForm requestId={r.id} currentStatus={r.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
