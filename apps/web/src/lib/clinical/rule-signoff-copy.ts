/**
 * What actually changes for patients and clinicians when a clinical rule
 * goes live. Keyed by rule_key so each sentence is specific rather than a
 * generic "this rule will start running" — the whole point is that someone
 * signing it can tell what they are agreeing to without reading a JSON
 * condition tree. A rule with no entry falls back to a plain, honest
 * description rather than an invented one.
 *
 * Extracted 2026-09-22 from admin/settings/clinical-signoff/page.tsx so the
 * CMO's own /clinician/clinical-signoff mirror can reuse the exact same
 * copy instead of drifting from it.
 */
export const WHAT_HAPPENS: Record<string, string> = {
  diagnostic_abnormal_screening_result_review:
    "An abnormal or critical screening result will automatically raise a clinical review task, instead of only being visible if someone looks. This is the prevention-to-chronic upgrade path.",
  engagement_repeated_missed_appointments:
    "A patient who repeatedly misses appointments gets flagged as disengaging, so the care team can reach out rather than lose them quietly.",
  htn_repeated_high_home_bp_review:
    "Repeated high home blood-pressure readings will raise a review task for the care team, rather than sitting in the patient's history unread.",
  medication_new_prescription_ckd_renal_monitoring:
    "Starting a new medication for a patient with CKD will prompt a renal-function recheck.",
  operational_missed_appointment_rebooking:
    "A missed appointment will prompt the patient to rebook promptly, rather than waiting for the next scheduled contact.",
  preventive_next_screening_after_normal_result:
    "A normal screening result will automatically schedule the next screening at the right interval.",
  referral_critical_screening_specialist_review:
    "A critical screening result will recommend a specialist referral for a doctor to review and act on.",
};
