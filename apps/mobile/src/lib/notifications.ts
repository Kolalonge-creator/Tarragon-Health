import { supabase } from "./supabase";

export interface InAppNotification {
  id: string;
  status: string;
  template: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

const LIMIT = 15;

/** Mirrors useInAppNotifications in apps/web/src/lib/queries/notifications.ts
 * — explicit recipient_id filter, same reasoning: RLS also admits org staff
 * reading a colleague's notifications on the broadcast/outreach surfaces,
 * which is correct there and wrong for a personal bell. */
export async function loadNotifications(userId: string): Promise<InAppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, status, template, payload, created_at")
    .eq("recipient_id", userId)
    .eq("channel", "in_app")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    template: row.template,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from("notifications")
    .update({ status: "read" })
    .eq("recipient_id", userId)
    .eq("channel", "in_app")
    .neq("status", "read");
  if (error) throw error;
}

/** Short line for the notification dropdown. Mirrors the patient/grantee-
 * facing half of notification-bell.tsx's describe() on web — same template
 * keys, same copy, no href since this dropdown has no navigation. The bell
 * on this app only ever renders to a patient or family-circle grantee (there
 * is no clinician/admin/finance surface in apps/mobile), so clinician- and
 * back-office-only templates (e.g. clinician_alert_sla_breach,
 * data_breach_deadline) are deliberately not ported here — they can never
 * reach this recipient.
 *
 * Anything genuinely unmapped falls back to a generic line, never the raw
 * template string — a leaked key ("security.new device signin") was the bug
 * this file was rewritten to fix. Add a case here for every new patient- or
 * grantee-facing in_app template so this list doesn't drift from web's
 * again. */
export function describeNotification(n: InAppNotification): string {
  const payload = n.payload;
  switch (n.template) {
    case "health_education_unlock": {
      const title = String(payload.lesson_title ?? "a new lesson");
      const count = Number(payload.lesson_count ?? 1);
      return count > 1
        ? `${count} new lessons ready, starting with "${title}"`
        : `New lesson ready: "${title}"`;
    }
    case "new_care_message": {
      const who = String(payload.author_display ?? "").trim();
      const role = payload.author_role;
      const from =
        role === "care_team" ? "the care team" : role === "sponsor" ? who || "someone who supports them" : who || "the patient";
      return `New message from ${from}`;
    }
    case "referral_closed": {
      const specialist = String(payload.specialist_type ?? "your specialist").replace(/_/g, " ");
      return `Your ${specialist} referral is closed. Your care plan was updated`;
    }
    case "referral_reminder": {
      const specialist = String(payload.specialist_type ?? "your specialist").replace(/_/g, " ");
      return `Don't forget your ${specialist} referral. Bring back what they find`;
    }
    case "health_reset_complete":
      return "Your 90-Day Health Reset is complete. Well done";
    case "video_visit_alternate_proposed":
      return "Your doctor offered a different time for your video visit: pick one";
    case "lab_result_consult_booked":
    case "lab_result_consult_rescheduled":
      return n.template === "lab_result_consult_rescheduled"
        ? "Your lab-result consultation was rescheduled"
        : "Your lab-result consultation is booked";
    case "lab_result_consult_needs_rescheduling":
      return "Your doctor can no longer make your lab-result consultation, so it needs a new time";
    case "care_access_view_request":
    case "care_access_manage_request": {
      const name = String(payload.initiator_name ?? "Someone");
      const level = payload.permission_level === "manage" ? "manage" : "view";
      return `${name} sent a request to ${level} care: respond in Your people`;
    }
    case "care_access_request_accepted":
    case "care_access_request_declined": {
      const name = String(payload.responder_name ?? "They");
      const accepted = n.template === "care_access_request_accepted";
      return `${name} ${accepted ? "accepted" : "declined"} your care access request`;
    }
    case "care_access_revoked": {
      const byOwner = payload.by_owner === true;
      const ownerName = String(payload.owner_name ?? "Someone");
      const granteeName = String(payload.grantee_name ?? "Someone");
      return byOwner ? `${ownerName} revoked your care access` : `${granteeName} gave up their care access`;
    }
    case "medication_refill_due":
    case "medication_refill_reminder": {
      const drug = String(payload.drug_name ?? "a medication");
      return `Refill reminder: ${drug} is due soon`;
    }
    case "medication_adherence_checkin": {
      const drug = String(payload.drug_name ?? "your medication");
      const checkinCopy: Record<string, string> = {
        started: `Have you started taking ${drug}?`,
        side_effects: `Any side effects from ${drug}?`,
        missed_doses: `How many doses of ${drug} have you missed?`,
        lab_review: `Time for a follow-up on ${drug}`,
      };
      return checkinCopy[String(payload.checkin_type ?? "")] ?? `A check-in for ${drug} is due`;
    }
    case "medication_dose_reminder": {
      const drug = String(payload.drug_name ?? "your medication");
      const time = String(payload.scheduled_time ?? "").trim();
      return time ? `Time to take ${drug} (${time})` : `Time to take ${drug}`;
    }
    case "medication_lab_monitoring_due": {
      const label = String(payload.monitoring_label ?? "A lab check");
      const drug = String(payload.drug_name ?? "your medication");
      return `${label} for ${drug} is due`;
    }
    case "voucher_gift_used": {
      const name = String(payload.beneficiary_name ?? "Someone you support");
      const label = String(payload.label ?? "the check you bought");
      return `${name} used ${label} that you bought for them`;
    }
    case "care_voucher_expiring": {
      const label = String(payload.label ?? "A care voucher");
      const on = String(payload.expires_on ?? "soon");
      return `${label} runs out on ${on}. Use it, or ask us and we will extend it.`;
    }
    case "reward_voucher_issued": {
      const label = String(payload.label ?? "A reward");
      const value = String(payload.value_naira ?? "");
      return value ? `${label}: a ₦${value} voucher toward your care` : `${label} added to your account`;
    }
    case "sponsor_monthly_report": {
      const name = String(payload.beneficiary_name ?? "Someone you support");
      const ready = Number(payload.ready_count ?? 0);
      const used = Number(payload.used_this_month ?? 0);
      return `Monthly summary for ${name}: ${used} used this month, ${ready} still waiting`;
    }
    case "sponsor_care_reviewed": {
      const name = String(payload.person_name ?? "someone you support");
      return `A doctor has reviewed something for ${name}`;
    }
    case "sponsor_person_quiet": {
      const name = String(payload.person_name ?? "someone you support");
      const days = Number(payload.quiet_days ?? 0);
      return `${name} hasn't logged a reading in ${days} days; a call might help`;
    }
    case "sponsored_plan_started": {
      const isPayer = payload.is_payer === true;
      const planName = String(payload.plan_name ?? "a plan");
      return isPayer
        ? `You are now paying for ${String(payload.person_name ?? "someone")}'s ${planName}`
        : `${String(payload.sponsor_name ?? "Someone")} is now paying for your ${planName}`;
    }
    case "abnormal_result_patient_followup":
      // Deliberately says only that a follow-up is needed, never the finding.
      return "Your result needs a follow-up. Your care team will be in touch";
    case "result_interpretation_ready":
      return "A doctor sent you an interpretation of a lab result you uploaded";
    case "free_tier_reading_self_care_suggestion": {
      const vital = String(payload.vital_label ?? "a reading");
      return `${vital}: ${String(payload.self_care_note ?? "please take a moment to check on this.")}`;
    }
    case "emergency_card_viewed": {
      const on = String(payload.viewed_on ?? "");
      return on ? `Your emergency card link was viewed on ${on}` : "Your emergency card link was viewed";
    }
    case "emergency_card_expiring_soon":
      return "Your emergency card link expires soon; renew it to keep it working";
    case "lab_order_patient_confirmation": {
      const test = String(payload.test_name ?? "your test");
      const lab = String(payload.lab_name ?? "the lab");
      return `Your order for ${test} at ${lab} is confirmed`;
    }
    case "lab_order_requested_patient": {
      const test = String(payload.test_name ?? "a lab test");
      const selfBooked = payload.self_booked === true;
      return selfBooked ? `${test} is ready: take it to your chosen lab` : `${test} has been requested for you`;
    }
    case "lab_sample_rejected": {
      const test = String(payload.test_name ?? "your test");
      const reason = String(payload.reason ?? "").trim();
      return reason ? `Your sample for ${test} was rejected: ${reason}` : `Your sample for ${test} was rejected`;
    }
    case "medication_prescribed_patient": {
      const drug = String(payload.drug_name ?? "A medication");
      return `${drug} was prescribed for you`;
    }
    case "pharmacy_order_patient_confirmation": {
      const items = String(payload.items_summary ?? "your medication");
      return `Your pharmacy order is confirmed: ${items}`;
    }
    case "pharmacy_order_ready_for_collection": {
      const pharmacy = String(payload.pharmacy_name ?? "the pharmacy");
      return `Your medication is ready for collection at ${pharmacy}`;
    }
    case "pharmacy_order_out_for_delivery": {
      const courier = String(payload.courier_name ?? "your courier");
      return `Your medication order is out for delivery with ${courier}`;
    }
    case "pharmacy_order_delivered":
      return "Your medication order has been delivered";
    case "pharmacy_order_delivery_failed":
      return "A delivery attempt for your medication order was unsuccessful";
    case "pharmacy_order_unavailable": {
      const pharmacy = String(payload.pharmacy_name ?? "the pharmacy");
      return `${pharmacy} could not fulfil your medication order as prescribed`;
    }
    case "referral_patient_confirmation": {
      const specialist = String(payload.specialist_name ?? "your specialist");
      return `Your referral to ${specialist} is confirmed`;
    }
    case "result_document_available":
      return "A new lab result document is available";
    case "emergency_followup":
      return "Checking in after your recent emergency alert. How are you doing?";
    case "region_now_available": {
      const name = String(payload.display_name ?? "Tarragon");
      return `${name} is now available in your area`;
    }
    case "annual_review_due":
      return "Your Annual Health Review is due";
    case "booking_reminder": {
      const service = String(payload.service_type ?? "your appointment");
      const days = Number(payload.days_before ?? 0);
      return days > 0 ? `${service} is coming up in ${days} day${days === 1 ? "" : "s"}` : `${service} is coming up`;
    }
    case "care_outreach_checkin":
      return "Your care team wants to check in with you";
    case "engagement_reengagement_nudge":
      return "We've missed seeing you around";
    case "engagement_reminder_personalized": {
      const dim = String(payload.lowest_dimension ?? "your health").replace(/_/g, " ");
      return `A gentle nudge to check in on ${dim}`;
    }
    case "engagement_support_offer": {
      const dim = String(payload.lowest_dimension ?? "your health").replace(/_/g, " ");
      return `We've noticed ${dim} has been quiet lately. We're here if you need support`;
    }
    case "diabetes_complication_check_due": {
      const checkType = String(payload.check_type ?? "complication");
      return `Your ${checkType} check is due`;
    }
    case "health_check_due_soon": {
      const bundle = String(payload.bundle_name ?? "your health check");
      return `${bundle} is due again soon`;
    }
    case "health_check_rebook_due": {
      const bundle = String(payload.bundle_name ?? "your health check");
      return `Time to rebook ${bundle}`;
    }
    case "lifestyle_review_due":
      return "Your lifestyle review is due";
    case "medication_review_due":
      return "Your medication review is due";
    case "preventive_review_due":
      return "Your preventive review is due";
    case "screening_due": {
      const screen = String(payload.screen_type_name ?? "A screening");
      return `${screen} is due`;
    }
    case "screening_upcoming":
    case "screening_overdue":
    case "screening_escalated": {
      const screen = String(payload.screen_type_name ?? "A screening");
      const label =
        n.template === "screening_upcoming"
          ? "is coming up soon"
          : n.template === "screening_overdue"
            ? "is overdue"
            : "is overdue: your care team may follow up";
      return `${screen} ${label}`;
    }
    case "vaccination_due": {
      const vaccine = String(payload.vaccine_name ?? "A vaccination");
      return `${vaccine} is due`;
    }
    case "vaccination_upcoming":
    case "vaccination_overdue":
    case "vaccination_escalated": {
      const vaccine = String(payload.vaccine_name ?? "A vaccination");
      const label =
        n.template === "vaccination_upcoming"
          ? "is coming up soon"
          : n.template === "vaccination_overdue"
            ? "is overdue"
            : "is overdue: your care team may follow up";
      return `${vaccine} ${label}`;
    }
    case "vitals_reminder":
      return "Time to log your vitals";
    case "vitals_monitoring_due":
    case "vitals_monitoring_overdue":
    case "vitals_monitoring_escalated": {
      const vital = String(payload.vital_type ?? "a reading").replace(/_/g, " ");
      const label =
        n.template === "vitals_monitoring_due"
          ? "is due"
          : n.template === "vitals_monitoring_overdue"
            ? "is overdue"
            : "is overdue: your care team has been notified";
      return `Logging your ${vital} ${label}`;
    }
    case "wellness_challenge_ending": {
      const title = String(payload.challenge_title ?? "Your challenge");
      return `${title} ends soon, keep going`;
    }
    case "second_condition_needs_upgrade": {
      const condition = String(payload.condition ?? "a condition").replace(/_/g, " ");
      return `We're now tracking ${condition} for you too. A doctor-supported programme adds a scheduled review for it`;
    }
    case "health_passport_attestation_declined": {
      const reason = String(payload.reason ?? "").trim();
      return reason
        ? `Your passport attestation request was declined: ${reason}`
        : "Your passport attestation request was declined";
    }
    case "health_passport_attested":
      return "Your health passport attestation is complete";
    case "health_passport_revoked": {
      const serial = String(payload.serial ?? "");
      const reason = String(payload.reason ?? "").trim();
      return reason
        ? `Your health passport credential${serial ? ` (${serial})` : ""} was revoked: ${reason}`
        : `Your health passport credential${serial ? ` (${serial})` : ""} was revoked`;
    }
    case "health_passport_verified": {
      const serial = String(payload.serial ?? "");
      return serial ? `Your vaccination certificate is verified (passport ${serial})` : "Your vaccination certificate is verified";
    }
    case "cycle_period_due_soon":
    case "cycle_period_due_today":
    case "cycle_period_late": {
      const days = Number(payload.days_overdue ?? 0);
      return n.template === "cycle_period_due_soon"
        ? "Your period is expected in a couple of days"
        : n.template === "cycle_period_due_today"
          ? "Your period is expected around today"
          : `Your period is ${days} days later than expected. Cycles shift for all sorts of reasons.`;
    }
    case "daily_digest": {
      const count = Number(payload.count ?? 0);
      return `${count} update${count === 1 ? "" : "s"} waiting for you today`;
    }
    case "escalation_resolved":
      return "A doctor has reviewed something on your record";
    case "family_access_request": {
      const name = String(payload.requester_name ?? "Someone");
      return `${name} sent a request to view your care`;
    }
    case "security.new_device_signin":
      return String(payload.message ?? "New sign-in to your account from a device we haven't seen before");
    case "consultation_summary_ready":
      return "A summary of your recent visit is ready to read";
    case "navigation_request_resolved":
      return "Your request for help has been resolved";
    case "adolescent_shared_access_nudge_13": {
      const name = String(payload.child_name ?? "The young person you support");
      return `${name} just turned 13. It's a good time to talk about what they'd like to keep private`;
    }
    case "adolescent_independence_downgrade_18": {
      const name = String(payload.child_name ?? "The young person you supported");
      return `${name} turned 18, so your access has moved from manage to view-only`;
    }
    case "appointment_reminder_for_dependent": {
      const type = String(payload.appointment_type ?? "An appointment").replace(/_/g, " ");
      return `${type} is coming up for someone you care for`;
    }
    case "dependent_majority_review":
      return String(
        payload.message ?? "Someone you have access for just turned 18. Their access level may need review"
      );
    case "caregiver_review_overdue":
      return "A periodic review of your care access is overdue";
    default:
      return "You have a new notification";
  }
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
