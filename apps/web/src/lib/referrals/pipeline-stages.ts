import type { StepperStep, StepperStepState } from "@/components/ui/stepper";
import type { ReferralStatus, ReferralUrgency } from "@tarragon/shared";

export interface ReferralPipelineInput {
  status: ReferralStatus;
  urgency: ReferralUrgency | null;
  specialist_provider_id: string | null;
  booking_confirmed_at: string | null;
  treatment_plan_received_at: string | null;
  shared_care_handback_at: string | null;
}

const BOOKED_STATUSES: ReferralStatus[] = ["booked", "confirmed", "completed"];

/**
 * Derives the master plan's 9-stage referral pipeline
 * (docs/Tarragon_Health_Master_Operating_Plan_v4.md §7 Level 5b) from
 * existing referral fields. Doctor Assessment and Referral Approved both
 * key off `urgency` being set — there's no separate DB signal distinguishing
 * "a doctor is looking at this" from "a doctor decided" short of joining
 * through screening_upgrades -> screening_results -> clinician_alerts ->
 * escalations, which is a fragile 4-hop reverse-FK chain for a cosmetic
 * distinction; this is a deliberate simplification, not an oversight.
 * A `declined` referral marks every stage from "Finding Specialist" onward
 * as skipped rather than upcoming.
 */
export function deriveReferralPipelineStages(referral: ReferralPipelineInput): StepperStep[] {
  const declined = referral.status === "declined";
  const urgencySet = referral.urgency !== null;
  const providerAssigned = referral.specialist_provider_id !== null;
  const booked = BOOKED_STATUSES.includes(referral.status) || referral.booking_confirmed_at !== null;
  const completed = referral.status === "completed";
  const planReceived = referral.treatment_plan_received_at !== null;
  const handedBack = referral.shared_care_handback_at !== null;

  const state = (complete: boolean, current: boolean): StepperStepState => {
    if (declined && !complete) return "skipped";
    if (complete) return "complete";
    if (current) return "current";
    return "upcoming";
  };

  return [
    { key: "abnormal_result", label: "Abnormal result", state: "complete" },
    {
      key: "awaiting_doctor_review",
      label: "Awaiting doctor review",
      state: state(urgencySet, !urgencySet),
    },
    { key: "doctor_assessment", label: "Doctor assessment", state: state(urgencySet, false) },
    { key: "referral_approved", label: "Referral approved", state: state(urgencySet, false) },
    {
      key: "finding_specialist",
      label: "Finding specialist",
      state: state(providerAssigned, urgencySet && !providerAssigned),
    },
    {
      key: "appointment_booked",
      label: "Appointment booked",
      state: state(booked, providerAssigned && !booked),
    },
    {
      key: "consultation_completed",
      label: "Consultation completed",
      state: state(completed || planReceived || handedBack, booked && !completed),
    },
    {
      key: "treatment_plan_received",
      label: "Treatment plan received",
      state: state(planReceived || handedBack, completed && !planReceived),
    },
    {
      key: "monitoring_continues",
      label: "Monitoring continues",
      state: state(false, planReceived),
    },
  ];
}
