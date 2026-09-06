/**
 * The one line of the emergency dialog whose truth depends on the patient's
 * plan, kept here as a pure function so it can be tested without rendering
 * the dialog.
 *
 * The dialog used to assert, unconditionally, that "your care team has also
 * been notified and will follow up". That is only true when a
 * clinician_alerts row was actually raised for the event, and
 * private.handle_emergency_event deliberately raises none on the free tier:
 * it checks private.patient_has_feature_access(patient,
 * 'vitals_red_flag_doctor_escalation') and, when that is false, writes a
 * self-care suggestion instead and pages nobody (CLAUDE.md, 2026-08-10).
 *
 * Everything else in that dialog is plan-independent and stays exactly as it
 * was: the event row itself, the acknowledge-gated "go to hospital now"
 * guidance, the emergency-contact notify, and the post-discharge check-in all
 * fire before any entitlement check, on every plan.
 *
 * `emergency_events.clinician_alert_id` is the record of what actually
 * happened for THIS event, written by that trigger at the moment it inserts
 * the alert. Reading it beats inferring from the patient's current
 * entitlement: a plan bought or lapsed after the event was raised cannot make
 * the sentence retroactively true or false.
 */
export function emergencyHospitalGuidance(clinicianAlertId: string | null | undefined): string {
  if (clinicianAlertId) {
    return "Go to the nearest hospital's emergency department. Your care team has been told about this and will follow up, but please don't wait to hear from them first.";
  }
  // No alert was raised, so no clinician has seen this. The line still has to
  // move the patient toward a hospital now; it just must not imply anyone
  // here is on the way.
  return "Go to the nearest hospital's emergency department. Please go now rather than waiting to hear from anyone here first.";
}
