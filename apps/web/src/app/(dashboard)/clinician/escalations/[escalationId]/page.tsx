import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canHandleEmergencyEscalation, isClinicalTier } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LEVEL_BADGE, ESCALATION_STATUS_BADGE } from "@/lib/worklist/level-badge";
import { RESULT_STATUS_BADGE } from "@/lib/worklist/result-status-badge";
import { requiresEmergencyAuthority } from "@/lib/worklist/priority";
import { VitalsTrendChart } from "@/components/vitals-trend-chart";
import { ReviewedByDoctor } from "@/components/reviewed-by-doctor";
import { CaseBriefCard } from "@/components/case-brief-card";
import { CaseActionsPanel } from "@/components/case-cockpit/case-actions-panel";
import { PatientTimeline } from "@/components/patient-timeline";
import { MedicationsList } from "@/app/(dashboard)/patient/medications-list";
import { StartVirtualReviewButton } from "./start-virtual-review-button";
import { AlertOverrideControl } from "./alert-override-control";
import { NotesPanel } from "./notes-panel";
import { ResolveForm } from "./resolve-form";

export default async function EscalationDetailPage({
  params,
}: {
  params: Promise<{ escalationId: string }>;
}) {
  const { escalationId } = await params;
  const supabase = await createClient();

  // RLS (private.is_org_staff) is the real gate here: an escalation outside
  // the caller's org simply doesn't come back, same as any other cross-tenant
  // lookup in this app.
  const { data: escalation } = await supabase
    .from("escalations")
    .select(
      "*, patient:profiles!escalations_patient_id_fkey(id, full_name, phone), clinician_alert:clinician_alerts!escalations_clinician_alert_id_fkey(title, detail, level, sla_due_at, override_level, override_reason, overridden_at, overridden_by_staff:clinical_staff!clinician_alerts_overridden_by_fkey(full_name), screening_result:screening_results!clinician_alerts_screening_result_id_fkey(result_status))"
    )
    .eq("id", escalationId)
    .maybeSingle();

  if (!escalation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Escalation not found</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">
            This escalation doesn&apos;t exist or isn&apos;t in your organisation.
          </p>
        </CardContent>
      </Card>
    );
  }

  const caseBrief = escalation.clinician_alert_id
    ? (
        await supabase
          .from("case_briefs")
          .select(
            "status, summary_text, suggested_action_text, draft_review_note, generated_at, protocol_version:protocol_versions!case_briefs_protocol_version_id_fkey(title, version_number)"
          )
          .eq("clinician_alert_id", escalation.clinician_alert_id)
          .maybeSingle()
      ).data
    : null;

  const effectiveLevel = escalation.clinician_alert
    ? (escalation.clinician_alert.override_level ?? escalation.clinician_alert.level)
    : null;
  const levelBadge = effectiveLevel ? LEVEL_BADGE[effectiveLevel] : null;
  const resultBadge = escalation.clinician_alert?.screening_result
    ? RESULT_STATUS_BADGE[escalation.clinician_alert.screening_result.result_status]
    : null;
  const statusBadge = ESCALATION_STATUS_BADGE[escalation.status];

  // Every doctor tier can view and work this case (unified access,
  // 2026-07-31) — but RESOLVING an emergency-level case needs a Tier 2+
  // doctor or the Clinical Director; see canHandleEmergencyEscalation.
  // requiresEmergencyAuthority (not the coalesced effectiveLevel used for
  // the badge above) is the same "level OR override_level is emergency"
  // predicate the DB trigger uses, so a Tier 1 who overrides an emergency
  // DOWN to routine cannot thereby unlock their own resolve on it.
  //
  // DELIBERATELY STRICTER THAN THE DB on one point: the trigger permits
  // status -> 'referred' at any tier (forwarding a case on is not closing
  // it), but this hides the whole ResolveForm, which offers Resolved and
  // Referred from one control. That is intentional — setting a specialist
  // referral's urgency is Tier 4 authority under the Clinical Tier Ladder,
  // so a Tier 1 should not be driving it either. The hand-off a Tier 1
  // SHOULD use is the note + virtual review the panel below points them at,
  // which leaves the case open for a senior colleague.
  const staff = await getCurrentClinicalStaff();
  const canResolveEmergency = canHandleEmergencyEscalation(staff);
  // A Care Coordinator carries an active clinical_staff row (doctor_tier =
  // 'care_coordinator') but must never resolve/refer a case and have that
  // attributed as a doctor's review — ReviewedByDoctor resolves reviewed_by
  // against clinical_staff by profile_id with no tier check, so it would
  // render "Reviewed by Dr. <coordinator's name>" on the patient's own
  // dashboard otherwise. isClinicalTier is the same non-emergency gate as
  // the escalation worklist's Claim button, checked ahead of the
  // emergency-tier gate below.
  const isClinicalStaff = isClinicalTier(staff);
  const resolveLocked =
    !isClinicalStaff ||
    (requiresEmergencyAuthority(escalation.clinician_alert) && !canResolveEmergency);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          {escalation.patient?.full_name ?? "Unnamed patient"}
        </h1>
        {escalation.patient?.phone && (
          <p className="text-charcoal-ink/60">{escalation.patient.phone}</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Escalation detail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            {resultBadge && <Badge variant={resultBadge.variant}>{resultBadge.label}</Badge>}
            {levelBadge && <Badge variant={levelBadge.variant}>{levelBadge.label}</Badge>}
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
          {escalation.clinician_alert && (
            <p className="text-sm text-charcoal-ink">
              {escalation.clinician_alert.title}
              {escalation.clinician_alert.detail && `: ${escalation.clinician_alert.detail}`}
            </p>
          )}
          <p className="text-sm text-charcoal-ink">Reason: {escalation.reason}</p>
          <StartVirtualReviewButton escalationId={escalation.id} />
          {escalation.clinician_alert_id && (
            <AlertOverrideControl
              alertId={escalation.clinician_alert_id}
              overrideLevel={escalation.clinician_alert?.override_level ?? null}
              overrideReason={escalation.clinician_alert?.override_reason ?? null}
              overriddenAt={escalation.clinician_alert?.overridden_at ?? null}
              overriddenByName={escalation.clinician_alert?.overridden_by_staff?.full_name ?? null}
            />
          )}
        </CardContent>
      </Card>

      {escalation.clinician_alert_id && (
        <>
          <CaseBriefCard
            clinicianAlertId={escalation.clinician_alert_id}
            initialBrief={
              caseBrief
                ? {
                    status: caseBrief.status,
                    summaryText: caseBrief.summary_text,
                    suggestedActionText: caseBrief.suggested_action_text,
                    draftReviewNote: caseBrief.draft_review_note,
                    protocolVersion: caseBrief.protocol_version
                      ? {
                          title: caseBrief.protocol_version.title,
                          versionNumber: caseBrief.protocol_version.version_number,
                        }
                      : null,
                    generatedAt: caseBrief.generated_at,
                  }
                : null
            }
          />
          {/*
            Sits directly under the brief and ABOVE the raw patient context
            below, which is the order a doctor works the case: read the
            summary, act on what the protocol already implies, then check the
            actions against the real record before closing. The full patient
            data stays on the page — the cockpit never replaces it.
          */}
          {escalation.patient?.id && (
            <CaseActionsPanel
              clinicianAlertId={escalation.clinician_alert_id}
              patientId={escalation.patient.id}
            />
          )}
        </>
      )}

      <ReviewedByDoctor escalationId={escalation.id} />

      {escalation.patient?.id && (
        <div className="space-y-6">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
            Patient context
          </h2>
          {/*
            The AI brief above is grounded in a snapshot of this same data
            (see lib/case-briefs/snapshot.ts) — a doctor resolving or
            referring a case needs the real, current record next to it, not
            just the AI's summary of an earlier read of it. Read-only here
            (refill/stop actions stay on the clinician patient page) since
            resolving an escalation is not a medication-management moment.
          */}
          <VitalsTrendChart patientId={escalation.patient.id} />
          <MedicationsList patientId={escalation.patient.id} refillCoordinationEnabled />
          <PatientTimeline patientId={escalation.patient.id} limit={10} />
        </div>
      )}

      <NotesPanel escalationId={escalation.id} organisationId={escalation.organisation_id} />

      {resolveLocked ? (
        <Card>
          <CardHeader>
            <CardTitle>Resolve escalation</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-charcoal-ink/60">
              {!isClinicalStaff
                ? "Only a doctor can resolve or refer this case. Use “Start virtual review” above, or leave a note, so a doctor has the context when they pick it up."
                : "This is an emergency-level case. Only a Tier 2+ doctor or the Clinical Director can claim or resolve it. Use “Start virtual review” above and flag it to a senior colleague; the case stays open until they act on it."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ResolveForm escalationId={escalation.id} />
      )}
    </div>
  );
}
