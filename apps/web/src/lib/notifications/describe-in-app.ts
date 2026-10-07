/** The two fields the copy depends on. `InAppNotification` (lib/queries/notifications.ts) satisfies it, and keeping it
 * structural lets the INV-07 lint in packages/notifications render every case without loading the web app. */
export interface InAppNotificationInput {
  template: string | null;
  payload: unknown;
}

/** Renders each in-app template's payload as a short line + a link to where
 * it's actually acted on. Add a case here for every new in_app template —
 * anything unmapped still shows (generic text, dashboard link) rather than
 * silently disappearing from the bell. Exported so the communication-history
 * card (17.8) can reuse the same copy instead of a second, drifting mapping. */
export function describe(n: InAppNotificationInput): { text: string; href: string } {
  const payload = (n.payload ?? {}) as Record<string, unknown>;
  if (n.template === "health_education_unlock") {
    const title = String(payload.lesson_title ?? "a new lesson");
    const count = Number(payload.lesson_count ?? 1);
    return {
      text:
        count > 1
          ? `${count} new lessons ready, starting with "${title}"`
          : `New lesson ready: "${title}"`,
      href: "/patient/prevention",
    };
  }
  if (n.template === "new_care_message") {
    // The same message reaches two different screens: the patient replies at
    // /patient/messages, a supporter replies inside that person's card on
    // /patient/supporting. recipient_kind is stamped by the trigger, since only
    // it knows which seat the reader is in.
    const supporter = payload.recipient_kind === "supporter";
    const who = String(payload.author_display ?? "").trim();
    const role = payload.author_role;
    const from =
      role === "care_team"
        ? "the care team"
        : role === "sponsor"
          ? who || "someone who supports them"
          : who || "the patient";
    return {
      text: `New message from ${from}`,
      href: supporter ? "/patient/supporting" : "/patient/messages",
    };
  }
  if (n.template === "clinician_new_care_message") {
    // Provider-facing counterpart to new_care_message — a patient or their
    // sponsor posted and the assigned clinician hadn't been told (see
    // 20260827203614_provider_notifications.sql).
    const who = String(payload.author_display ?? "").trim();
    const from = payload.author_role === "sponsor" ? who || "a supporter" : who || "the patient";
    return {
      text: `New message from ${from}`,
      href: `/clinician/patients/${String(payload.patient_id ?? "")}`,
    };
  }
  if (n.template === "clinician_unread_care_message_alert") {
    // From private.raise_unread_clinical_message_alerts() (77.13) — a
    // clinical-category patient message has sat unread by the care team
    // past the reminder window. Routes to the alerts worklist, same as
    // every other clinician_alerts-backed notification, rather than
    // straight into Messages — resolving the underlying clinician_alerts
    // row is the accountable action, opening the thread is just step one.
    // That worklist is /clinician (<Worklist />, reads clinician_alerts),
    // NOT /clinician/escalations (EscalationWorklist, reads public.
    // escalations — a row that only exists once a human clicks "escalate",
    // so this alert can never appear there). Verified against the live
    // function definition: raise_unread_clinical_message_alerts writes
    // clinician_alerts and never touches escalations.
    return {
      text: "A patient's clinical message has gone unread",
      href: "/clinician",
    };
  }
  if (n.template === "curbside_consult_new_message") {
    // Doctor-to-doctor curbside consult (20260922230142_curbside_consults.sql)
    // -- no sender_display in the payload (unlike new_care_message's frozen
    // author_display): both parties are org staff and clinical_staff is
    // already org-wide readable, so the client resolves the name itself
    // rather than needing it frozen at insert time.
    const subject = String(payload.subject ?? "your curbside consult").trim();
    return {
      text: `New reply in "${subject}"`,
      href: "/clinician/curbside-consults",
    };
  }
  if (n.template === "clinician_new_referral") {
    return {
      text: "New referral to triage",
      href: "/clinician/referrals",
    };
  }
  if (n.template === "clinician_referral_outcome_received") {
    const referralId = String(payload.referral_id ?? "");
    return {
      text: "A specialist outcome came back",
      href: referralId ? `/clinician/referrals/${referralId}` : "/clinician/referrals",
    };
  }
  if (n.template === "referral_closed") {
    return {
      text: "Your referral is closed. Your care plan was updated",
      href: "/patient",
    };
  }
  if (n.template === "referral_reminder") {
    return {
      text: "Don't forget your referral. Bring back what they find",
      href: "/patient",
    };
  }
  if (n.template === "clinician_care_plan_task") {
    const reason = String(payload.reason ?? "a care plan needs review");
    return {
      text: `Care plan task: ${reason}`,
      href: "/clinician/care-plan-review",
    };
  }
  if (n.template === "pharmacy_flag_notice") {
    // S36h: neutral by design (INV-07). Names no medicine, patient or reason; the detail is on the page.
    return { text: "A pharmacy has raised something. Open your pharmacy messages", href: "/clinician/pharmacy" };
  }
  // S28: neutral by design (INV-07): never a medicine, a person or a collection code.
  if (n.template === "pharmacy_new_prescription") {
    return { text: "Something is waiting for you", href: "/pharmacist/prescriptions" };
  }
  if (n.template === "pharmacy_question_answered") {
    return { text: "Your question was answered. Open the app to see it", href: "/pharmacist/prescriptions" };
  }
  if (n.template === "pharmacy_collection_update" || n.template === "prescription_sent_patient" || n.template === "prescription_collected_patient") {
    return { text: "Your pharmacy has an update. Open the app to see it", href: "/patient/medications" };
  }
  if (n.template === "health_reset_complete") {
    return {
      // Plans were retired 2026-09-02; the completed Reset is its own win now.
      text: "Your 90-Day Health Reset is complete. Well done",
      href: "/patient",
    };
  }
  // S21: neutral previews (INV-07).
  if (n.template === "video_call_requested") {
    return { text: "Your care team would like a quick call. Open the app to join.", href: `/patient/video-visit/${String(payload.consultation_id ?? "")}` };
  }
  if (n.template === "consult_join_ready") {
    return { text: "Your consultation room is open. Open the app to join.", href: `/patient/consultation/${String(payload.encounter_id ?? "")}` };
  }
  if (n.template === "consult_missed") {
    return {
      text: payload.credit_returned === true ? "Your consultation did not go ahead. Your credit is back in the app." : "Your consultation did not go ahead. Open the app to rebook.",
      href: "/patient/care",
    };
  }
  if (n.template === "video_visit_alternate_proposed") {
    return {
      text: "Your doctor offered a different time for your video visit: pick one",
      href: "/patient/care",
    };
  }
  if (n.template === "lab_result_consult_request_pending") {
    // From private.notify_new_lab_result_consult_request() — a patient just
    // paid the self-arranged lab-result consultation fee. Org-wide (any
    // active, non-Care-Coordinator clinician can pick it up), so this fires
    // for every clinician on the team, not just one assigned doctor.
    return {
      text: "A patient is waiting for you to pick a time",
      href: "/clinician/lab-result-consults",
    };
  }
  if (n.template === "lab_result_consult_booked" || n.template === "lab_result_consult_rescheduled") {
    const rescheduled = n.template === "lab_result_consult_rescheduled";
    return {
      text: rescheduled
        ? "Your appointment was rescheduled"
        : "Your appointment is booked",
      href: "/patient/labs",
    };
  }
  if (n.template === "lab_result_consult_needs_rescheduling") {
    return {
      text: "Your appointment needs a new time",
      href: "/patient/labs",
    };
  }
  if (n.template === "care_access_view_request" || n.template === "care_access_manage_request") {
    const name = String(payload.initiator_name ?? "Someone");
    const level = payload.permission_level === "manage" ? "manage" : "view";
    return {
      text: `${name} sent a request to ${level} care: respond in Your people`,
      href: "/patient/family",
    };
  }
  if (n.template === "care_access_request_accepted" || n.template === "care_access_request_declined") {
    const name = String(payload.responder_name ?? "They");
    const accepted = n.template === "care_access_request_accepted";
    return {
      text: `${name} ${accepted ? "accepted" : "declined"} your care access request`,
      href: "/patient/family",
    };
  }
  // INV-07: an in-app preview never names a medicine, whatever an older row's payload still carries.
  if (n.template === "medication_refill_reminder") {
    return {
      text: "A reminder is coming up. Open the app to see when.",
      // S28: the Medicines screen carries the "choose where to collect" link on each prescription
      href: "/patient/medications",
    };
  }
  if (n.template === "medication_dose_reminder") {
    const scheduledTime = String(payload.scheduled_time ?? "now");
    return {
      text: `It's ${scheduledTime}: time for your care plan check`,
      href: "/patient/medications",
    };
  }
  if (n.template === "medication_adherence_checkin") {
    return {
      text: "A quick check-in is waiting for you",
      href: "/patient/medications",
    };
  }
  if (n.template === "voucher_gift_used") {
    // From private.notify_purchaser_of_voucher_use(). The receipt somebody who
    // bought care for another person gets when it is actually used. Names the
    // service and the amount, never a result: paying for care and being
    // allowed to read it are separate permissions.
    const name = String(payload.beneficiary_name ?? "Someone you support");
    const label = String(payload.label ?? "the check you bought");
    return {
      text: `${name} used ${label} that you bought for them`,
      href: "/patient/supporting",
    };
  }
  if (n.template === "care_voucher_expiring") {
    const label = String(payload.label ?? "A care voucher");
    const on = String(payload.expires_on ?? "soon");
    return {
      text: `${label} runs out on ${on}. Use it, or ask us and we will extend it.`,
      href: "/patient/care",
    };
  }
  if (n.template === "service_purchase_expiring") {
    const label = String(payload.label ?? "A paid service");
    const on = String(payload.expires_on ?? "soon");
    return {
      text: `${label} runs out on ${on}. Buy it again to keep it going.`,
      href: "/patient/subscription",
    };
  }
  if (n.template === "reward_voucher_issued") {
    const label = String(payload.label ?? "A reward");
    const value = String(payload.value_naira ?? "");
    return {
      text: value ? `${label}: a ₦${value} voucher towards your care` : `${label} added to your account`,
      href: "/patient/care",
    };
  }
  if (n.template === "sponsor_monthly_report") {
    // From private.queue_sponsor_monthly_reports(). The standing monthly
    // summary to whoever is paying for someone else's care: what they have
    // bought, what has been used and what is still waiting. Never clinical content,
    // for the same reason as the spend receipt above.
    const name = String(payload.beneficiary_name ?? "Someone you support");
    const ready = Number(payload.ready_count ?? 0);
    const used = Number(payload.used_this_month ?? 0);
    return {
      text: `Monthly summary for ${name}: ${used} used this month, ${ready} still waiting`,
      href: "/patient/supporting",
    };
  }
  if (n.template === "sponsor_care_reviewed") {
    // From private.notify_sponsors_care_reviewed(). A doctor has actually
    // looked at something for the person you support. THAT it happened, never
    // what was found — the patient and their doctor discuss that first, and
    // this row is non_clinical precisely so it can travel on any channel.
    const name = String(payload.person_name ?? "someone you support");
    return {
      text: `A doctor has reviewed something for ${name}`,
      href: "/patient/supporting",
    };
  }
  if (n.template === "sponsor_person_quiet") {
    // From private.queue_sponsor_quiet_nudges(). Someone with an active care
    // plan has stopped logging readings. An activity fact, not a health
    // judgement — the useful thing a supporter abroad can do is ring them.
    const name = String(payload.person_name ?? "someone you support");
    const days = Number(payload.quiet_days ?? 0);
    return {
      text: `${name} hasn't opened the app in ${days} days; a call might help`,
      href: "/patient/supporting",
    };
  }
  if (n.template === "sponsored_plan_started") {
    // From private.activate_sponsored_subscription(). Sent to BOTH sides: the
    // person whose care it is must never discover they were put on a paid plan
    // by noticing new features appear.
    const isPayer = payload.is_payer === true;
    const planName = String(payload.plan_name ?? "a plan");
    return {
      text: isPayer
        ? `You are now paying for ${String(payload.person_name ?? "someone")}'s ${planName}`
        : `${String(payload.sponsor_name ?? "Someone")} is now paying for your ${planName}`,
      href: isPayer ? "/patient/supporting" : "/patient/subscription",
    };
  }
  if (n.template === "care_message_safety_flag") {
    // From private.after_care_message_insert_safety_screen() (17.12) — a
    // patient/sponsor care message matched the deterministic danger-phrase
    // safety screen. Always clinical content, always in_app-first per
    // private.notify_clinician_alert() — this is the proactive page, the
    // clinician_alerts worklist entry is the record of it, and that worklist
    // is /clinician. (after_care_message_insert_safety_screen writes
    // clinician_alerts only — confirmed against the live definition — so
    // /clinician/escalations would be a structurally empty queue.)
    return {
      text: "Priority 1: a care message may describe an emergency, needs review now",
      href: "/clinician",
    };
  }
  if (n.template === "security.new_device_signin") {
    return {
      text: "New sign-in to your account from a device we haven't seen before",
      href: "/patient/settings/security",
    };
  }
  if (
    n.template === "vitals_monitoring_due" ||
    n.template === "vitals_monitoring_overdue" ||
    n.template === "vitals_monitoring_escalated"
  ) {
    const copy =
      n.template === "vitals_monitoring_due"
        ? "Time for your check-in"
        : n.template === "vitals_monitoring_overdue"
          ? "Your check-in is waiting: please log one when you can"
          : "Your check-in has been waiting and your care team has been notified";
    return { text: copy, href: "/patient/vitals" };
  }
  if (n.template === "critical_notification_escalation_exhausted") {
    // From private.escalate_unconfirmed_critical_notifications() —
    // every channel in a critical alert's ladder
    // ran out with nobody confirming it. Admin-only visibility surface;
    // the underlying clinical SLA/worklist safety net is unaffected either
    // way, this is purely "a notification chain needs a human look."
    const sourceTable = String(payload.source_table ?? "");
    return {
      text: "A critical alert went unconfirmed on every channel: needs a look",
      // source_table 'clinician_alerts' means the underlying row is in
      // clinician_alerts, which the /clinician worklist renders — not
      // public.escalations, which /clinician/escalations renders.
      href: sourceTable === "clinician_alerts" ? "/clinician" : "/admin",
    };
  }
  if (n.template === "abnormal_result_patient_followup") {
    // From supabase/functions/abnormal-result-handler — the in-app copy of
    // the patient follow-up message, always written for a NON-sensitive
    // abnormal/critical result (a sensitive positive is never auto-messaged
    // at all; a doctor breaks that news). Deliberately says only that a
    // follow-up is needed, never the finding.
    return {
      text: "Your care team will be in touch. Open the app to see why",
      href: "/patient/labs",
    };
  }
  if (n.template === "result_interpretation_ready") {
    return {
      text: "Your care team sent you a note about something you uploaded",
      href: "/patient/labs",
    };
  }
  // Retired template (S22): the old ask-a-doctor answer notice. Kept only so historical inbox rows still render.
  if (n.template === "async_consult_answered") {
    return {
      text: "Your care team replied to your message",
      href: "/patient/care",
    };
  }
  // S22 written questions and clinical notes. Neutral by design (INV-07): never the question, a condition or a reading.
  if (n.template === "written_question_received") {
    return { text: "Your care team has your message", href: "/patient/care" };
  }
  if (n.template === "lab_result_corrected") {
    return { text: "Your care team has updated something in your health record. Open the app to see what changed", href: "/patient/labs" };
  }
  if (n.template === "lab_result_ready") {
    return { text: "Your care team has added something to your health record. Open the app to see it", href: "/patient/labs" };
  }
  if (n.template === "written_question_answered") {
    return { text: "Your care team has replied. Open the app to read it", href: "/patient/care" };
  }
  if (n.template === "written_question_info_needed") {
    return { text: "Your care team has a question for you", href: "/patient/care" };
  }
  if (n.template === "written_question_window_missed") {
    return { text: "Sorry for the wait. Your message is still with the team", href: "/patient/care" };
  }
  if (n.template === "written_question_call_planned") {
    return { text: "Your care team will call you. Keep your phone close", href: "/patient/care" };
  }
  if (n.template === "written_question_staff_notice") {
    return { text: "A written message needs attention", href: "/clinician/async-consults" };
  }
  if (n.template === "note_correction_requested") {
    return { text: "A patient asked for a correction to a note. Open your messages to answer", href: "/clinician/messages" };
  }
  if (n.template === "note_release_requested") {
    return { text: "A patient asked about a note. Open your messages to answer", href: "/clinician/messages" };
  }
  if (n.template === "note_released") {
    return { text: "Your care team has made a note available", href: "/patient/care" };
  }
  if (n.template === "note_release_declined" || n.template === "note_correction_answered") {
    return { text: "Your care team has replied to your request", href: "/patient/care" };
  }
  if (n.template === "note_unsigned_reminder") {
    return { text: "A note is waiting for your signature", href: "/clinician/patients" };
  }
  // S24 care plan changes. Neutral by design (INV-07): ids only in the payload, never a medicine, reading or condition.
  if (n.template === "care_change_ready_patient") {
    return { text: "Your care team has a change for you", href: "/patient/medications" };
  }
  if (n.template === "care_change_declined_staff") {
    return { text: "A patient answered a change. Nothing was changed", href: "/clinician/patients" };
  }
  if (n.template === "care_change_expired_staff") {
    return { text: "A signed change lapsed. Nothing was changed", href: "/clinician/patients" };
  }
  if (n.template === "second_opinion_answered") {
    return {
      text: "A doctor answered your second opinion request",
      href: "/patient/care",
    };
  }
  if (n.template === "free_tier_reading_self_care_suggestion") {
    // From private.raise_dangerous_reading_ai_suggestion() / assess-glucose.ts
    // raiseGlucoseAlert() — the Tarragon Free alternative to doctor escalation
    // for a dangerous vitals/symptom reading (20260810120000_gate_vitals_red_
    // flag_escalation_to_paid_plans.sql). Deterministic self-care copy, not a
    // doctor's assessment — the full text lives in payload.self_care_note so
    // it can be specific to what was actually flagged.
    // INV-07: the preview never carries the reading or the note (OQ-94). The full self-care text is shown in the app.
    return {
      text: "Something needs your attention. Open the app to see what to do next",
      href: "/patient/subscription",
    };
  }
  if (n.template === "emergency_card_viewed") {
    const on = String(payload.viewed_on ?? "");
    return {
      text: on ? `Your emergency card link was viewed on ${on}` : "Your emergency card link was viewed",
      href: "/patient/emergency-card",
    };
  }
  if (n.template === "emergency_card_expiring_soon") {
    return {
      text: "Your emergency card link expires soon; renew it to keep it working",
      href: "/patient/emergency-card",
    };
  }
  if (n.template === "lab_order_patient_confirmation") {
    const lab = String(payload.lab_name ?? "the partner");
    return { text: `Your order at ${lab} is confirmed`, href: "/patient/labs" };
  }
  if (n.template === "lab_order_requested_patient") {
    const selfBooked = payload.self_booked === true;
    return {
      text: selfBooked
        ? "Your order is ready: take it with you"
        : "Your care team made a request for you",
      href: "/patient/labs",
    };
  }
  if (n.template === "medication_prescribed_patient") {
    return { text: "Your care team added something new for you", href: "/patient/medications" };
  }
  if (n.template === "prescription_updated_patient") {
    return {
      text: "A document was updated. Get the new one: any copy you saved earlier no longer works.",
      href: "/patient/medications",
    };
  }
  if (n.template === "prescription_expiring_soon") {
    const when = typeof payload.expires_at === "string" ? ` on ${new Date(payload.expires_at).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" })}` : " soon";
    return {
      text: `A document of yours expires${when}. Ask for a renewal if you still need it.`,
      href: "/patient/medications",
    };
  }
  if (n.template === "prescription_supply_recorded") {
    const pharmacy = String(payload.pharmacy_name ?? "a pharmacy");
    return {
      text: `${pharmacy} recorded a supply for you. If that was not you, open the app and tap "This wasn't me".`,
      href: "/patient/medications",
    };
  }
  if (n.template === "pharmacy_order_patient_confirmation") {
    // /patient/pharmacy has no page — Medications is where a patient's
    // pharmacy orders and refills actually live.
    return { text: "Your pharmacy order is confirmed", href: "/patient/medications" };
  }
  if (n.template === "pharmacy_order_ready_for_collection") {
    const pharmacy = String(payload.pharmacy_name ?? "the pharmacy");
    return { text: `Your order is ready for collection at ${pharmacy}`, href: "/patient/medications" };
  }
  if (n.template === "pharmacy_order_unavailable") {
    const pharmacy = String(payload.pharmacy_name ?? "the pharmacy");
    return { text: `${pharmacy} could not complete your order`, href: "/patient/medications" };
  }
  if (n.template === "referral_patient_confirmation") {
    const specialist = String(payload.specialist_name ?? "your specialist");
    // /patient/referrals has no page — YourReferrals renders on Care & support.
    return { text: `Your referral to ${specialist} is confirmed`, href: "/patient/care" };
  }
  if (n.template === "result_document_available") {
    return { text: "Something new is waiting in your record", href: "/patient/labs" };
  }
  if (n.template === "emergency_followup") {
    return { text: "Checking in after your recent emergency alert. How are you doing?", href: "/patient" };
  }
  if (n.template === "region_now_available") {
    const name = String(payload.display_name ?? "Tarragon");
    return { text: `${name} is now available in your area`, href: "/patient" };
  }
  if (n.template === "annual_review_due") {
    return { text: "Your Annual Health Review is due", href: "/patient/health-check" };
  }
  if (n.template === "booking_reminder") {
    const days = Number(payload.days_before ?? 0);
    return {
      text: days > 0 ? `Your request is coming up in ${days} day${days === 1 ? "" : "s"}` : "Your request is coming up",
      href: "/patient/care",
    };
  }
  if (n.template === "care_outreach_checkin") {
    return { text: "Your care team wants to check in with you", href: "/patient" };
  }
  if (n.template === "engagement_reengagement_nudge") {
    // From private.compute_patient_engagement_tiers(). No clinical claim here —
    // just an honest "we noticed" nudge back to the dashboard.
    return { text: "We've missed seeing you around", href: "/patient" };
  }
  if (n.template === "diabetes_complication_check_due") {
    const checkType = String(payload.check_type ?? "complication");
    return { text: `Your ${checkType} check is due`, href: "/patient/care" };
  }
  if (n.template === "health_check_due_soon") {
    return { text: "Your annual check-up is due again soon", href: "/patient/health-check" };
  }
  if (n.template === "health_check_rebook_due") {
    return { text: "Time to rebook your annual check-up", href: "/patient/health-check" };
  }
  if (n.template === "lifestyle_review_due") {
    return { text: "Your lifestyle review is due", href: "/patient/lifestyle" };
  }
  if (n.template === "medication_review_due") {
    return { text: "A review with your care team is due", href: "/patient/medications" };
  }
  if (n.template === "preventive_review_due") {
    return { text: "Your preventive review is due", href: "/patient/prevention" };
  }
  if (n.template === "screening_due") {
    return { text: "A reminder is due", href: "/patient/prevention" };
  }
  if (n.template === "vaccination_due") {
    return { text: "A reminder is due", href: "/patient/prevention" };
  }
  if (n.template === "vitals_reminder") {
    return { text: "Time to log your vitals", href: "/patient/vitals" };
  }
  if (n.template === "wellness_challenge_ending") {
    const title = String(payload.challenge_title ?? "Your challenge");
    return { text: `${title} ends soon, keep going`, href: "/patient/wellness" };
  }
  if (n.template === "second_condition_needs_upgrade") {
    // From private.ensure_medication_review() — the patient's second
    // concurrent active condition. Framed as good news (caught early), not
    // a block: the condition itself, and any urgent escalation on it, are
    // never gated — only its own scheduled review cadence is.
    // "Complete Care" (the retired plan) used to be named here; the
    // doctor-supported programme is the pay-per-service successor that
    // carries a scheduled review.
    return {
      text: "Your care team has an update about your plan. Open the app to see it",
      href: "/patient/subscription",
    };
  }
  if (n.template === "daily_digest") {
    // Spec §76.14 (fatigue management) — supabase/functions/send-pending-
    // notifications/index.ts folds several same-day routine reminders into
    // one of these instead of sending each on its own external channel; the
    // in-app row is always created individually so nothing is silently lost.
    const count = Number(payload.count ?? 0);
    return {
      text: `${count} update${count === 1 ? "" : "s"} waiting for you today`,
      // Deliberately not payload.action_centre_url — that's a full external
      // URL (appUrl() in the edge function), useful for an email
      // link, but router.push() here needs an internal relative path.
      href: "/patient/actions",
    };
  }
  if (n.template === "care_access_revoked") {
    // From private.revoke_care_access() (care_graph_unification.sql).
    // by_owner tells the RECIPIENT who acted: true when the owner revoked
    // someone else's access (recipient is the grantee who lost it), false
    // when the grantee gave up their own access (recipient is the owner).
    const byOwner = payload.by_owner === true;
    const ownerName = String(payload.owner_name ?? "Someone");
    const granteeName = String(payload.grantee_name ?? "Someone");
    return {
      text: byOwner ? `${ownerName} revoked your care access` : `${granteeName} gave up their care access`,
      href: "/patient/family",
    };
  }
  if (n.template === "clinical_staff_indemnity_lapse" || n.template === "clinical_staff_license_lapse") {
    // From clinical_staff_indemnity_lapse_notify.sql /
    // clinical_staff_license_expiry_tracking.sql. payload.message is
    // already the fully-resolved admin-facing sentence -- same
    // "no branching to reproduce" shape as clinician_alert_ack_timeout_*.
    return { text: String(payload.message ?? "A clinician's credentials need review"), href: "/admin" };
  }
  if (n.template === "circle_check_in") {
    // From private.notify_circle_red_alert (S29): fixed neutral line for a supporter who holds red_alerts (INV-07).
    return { text: "Someone in your Care Circle may need you. Please call them.", href: "/patient/supporting" };
  }
  if (n.template === "circle_joined") {
    return { text: "Someone has joined your Care Circle", href: "/patient/care-circle" };
  }
  if (n.template === "circle_left") {
    return { text: "Someone has left your Care Circle", href: "/patient/care-circle" };
  }
  if (n.template === "circle_expiring") {
    return { text: "Someone's access to your Care Circle ends soon", href: "/patient/care-circle" };
  }
  if (n.template === "circle_expiring_soon") {
    return { text: "Someone's access to your Care Circle ends in a few days. Renew it if you want them to keep it", href: "/patient/care-circle" };
  }
  if (n.template === "circle_pause_ended") {
    return { text: "Your pause on sharing has ended. Your Care Circle can see what you chose to share again", href: "/patient/care-circle" };
  }
  if (n.template === "circle_gift_waiting") {
    return { text: "Someone has paid for care for you. Open it to accept", href: "/patient/care-circle" };
  }
  if (n.template === "monthly_report_ready") {
    return { text: "Your monthly summary is ready", href: "/patient/progress" };
  }
  if (n.template === "sponsor_figures_ready") {
    return { text: "Your programme figures for last month are ready", href: "/" };
  }
  if (n.template === "circle_paid_for_you") {
    return { text: "Someone in your Care Circle has paid for your care", href: "/patient" };
  }
  if (n.template === "on_call_page") {
    // From private.page_notify (S19): fixed neutral line, never the patient or the reading (INV-07).
    return { text: "A priority case is waiting for you", href: "/clinician/on-call" };
  }
  if (n.template === "assistant_daily_nudge") {
    // S51: generic by design (INV-07): no condition, reading or medicine is ever named.
    return { text: "Your check-in for today is ready", href: "/patient/care" };
  }
  if (n.template === "assistant_weekly_reflection") {
    return { text: "Your look back at this week is ready", href: "/patient/care" };
  }
  if (n.template === "assistant_reengage") {
    return { text: "It has been a little while. Your assistant is here whenever you have a question", href: "/patient/care" };
  }
  if (n.template === "on_call_unfinished") {
    return { text: "A priority case is acknowledged but still open", href: "/rota" };
  }
  if (n.template === "on_call_escalation") {
    return { text: "A priority case has not been picked up", href: "/rota" };
  }
  if (n.template === "care_team_notice") {
    // From private.lead_notify_patient (S18): fixed wording by kind, no names, nothing clinical (INV-07).
    const kind = payload.kind;
    return {
      text:
        kind === "changed"
          ? "Your care team lead has changed"
          : kind === "arranging"
            ? "We are arranging your care team lead"
            : "Your care team now has a lead clinician for you",
      href: "/patient",
    };
  }
  if (n.template === "credential_notice") {
    // From 20261006013217_s15_clinician_credentialing.sql (private.credential_notify). payload.message is the fully
    // resolved sentence. audience says who is reading: an applicant or a paused clinician (their role is back to
    // patient, so they go to the join page), a reviewer (the role-aware /credentialing redirect), or a working
    // clinician (their own credentials page).
    const audience = payload.audience;
    return {
      text: String(payload.message ?? "There is an update about your clinician account"),
      href:
        audience === "applicant" ? "/account/clinician"
        : audience === "reviewer" ? "/credentialing"
        : audience === "rota_review" ? "/rota"
        : audience === "rota" ? "/clinician/rota"
        : audience === "lead" ? "/clinician/patients"
        : "/clinician/credentials",
    };
  }
  if (n.template === "clinician_alert_sla_breach") {
    // From clinician_alert_sla_breach_escalation.sql. Same pre-resolved
    // payload.message shape. The breached row is a clinician_alerts row, so
    // it is worked on /clinician, not in the escalations queue.
    return {
      text: String(payload.message ?? "An open clinician alert breached its resolution SLA"),
      href: "/clinician",
    };
  }
  if (
    n.template === "clinician_alert_ack_timeout_backup" ||
    n.template === "clinician_alert_ack_timeout_senior" ||
    n.template === "clinician_alert_ack_timeout_admin"
  ) {
    // From private.escalate_unacknowledged_clinician_alerts() — the
    // abnormal-screening-result pipeline's strongest backstop: an alert
    // nobody acknowledged is re-pointed at a backup clinician, then a senior,
    // then an admin. These three had no case at all, so they fell to the
    // generic fallback below and rendered to a doctor as "You have an update"
    // linking to /patient — discarding a payload.message that already reads
    // 'Alert "Priority 1: abnormal screening result" (severity 4) has been
    // open 90 minutes, past its 30-minute acknowledgement target.' Same
    // pre-resolved payload.message shape as clinician_alert_sla_breach; the
    // underlying row is a clinician_alerts row, worked on /clinician.
    return {
      text: String(payload.message ?? "An unacknowledged clinician alert needs picking up"),
      href: "/clinician",
    };
  }
  if (n.template === "data_breach_deadline") {
    // From data_breach_incidents.sql. Same pre-resolved payload.message shape.
    return { text: String(payload.message ?? "An NDPC breach-notification deadline needs attention"), href: "/admin" };
  }
  if (n.template === "partner_license_expiry") {
    // From partner_regulatory_license_tracking.sql. Same pre-resolved
    // payload.message shape.
    return { text: String(payload.message ?? "A partner facility's licence needs review"), href: "/admin" };
  }
  if (n.template === "health_passport_attestation_declined") {
    const reason = String(payload.reason ?? "").trim();
    return {
      text: reason ? `Your passport attestation request was declined: ${reason}` : "Your passport attestation request was declined",
      href: "/patient/health-passport",
    };
  }
  if (n.template === "health_passport_attested") {
    return { text: "Your health passport attestation is complete", href: "/patient/health-passport" };
  }
  if (n.template === "health_passport_revoked") {
    const serial = String(payload.serial ?? "");
    const reason = String(payload.reason ?? "").trim();
    return {
      text: reason
        ? `Your health passport credential${serial ? ` (${serial})` : ""} was revoked: ${reason}`
        : `Your health passport credential${serial ? ` (${serial})` : ""} was revoked`,
      href: "/patient/health-passport",
    };
  }
  if (n.template === "health_passport_verified") {
    const serial = String(payload.serial ?? "");
    return {
      text: serial ? `Your document is verified (reference ${serial})` : "Your document is verified",
      href: "/patient/health-passport",
    };
  }
  if (n.template === "screening_upcoming" || n.template === "screening_overdue" || n.template === "screening_escalated") {
    // From escalating_preventive_reminders.sql -- the overdue/escalated
    // siblings of screening_due above, same payload shape.
    const label =
      n.template === "screening_upcoming" ? "A reminder is coming up soon"
      : n.template === "screening_overdue" ? "A reminder is still waiting"
      : "A reminder is still waiting: your care team may follow up";
    return { text: label, href: "/patient/prevention" };
  }
  if (n.template === "vaccination_upcoming" || n.template === "vaccination_overdue" || n.template === "vaccination_escalated") {
    // From escalating_preventive_reminders.sql -- the overdue/escalated
    // siblings of vaccination_due above, same payload shape.
    const label =
      n.template === "vaccination_upcoming" ? "A reminder is coming up soon"
      : n.template === "vaccination_overdue" ? "A reminder is still waiting"
      : "A reminder is still waiting: your care team may follow up";
    return { text: label, href: "/patient/prevention" };
  }
  if (
    n.template === "cycle_period_due_soon" ||
    n.template === "cycle_period_due_today" ||
    n.template === "cycle_period_late"
  ) {
    // From lib/cycle/reminders.ts. Worded softly on purpose: an estimate
    // that turns out to be wrong should read as a guess that missed, not as
    // the app telling somebody something is wrong with them.
    const days = Number(payload.days_overdue ?? 0);
    const text =
      n.template === "cycle_period_due_soon"
        ? "Your period is expected in a couple of days"
        : n.template === "cycle_period_due_today"
          ? "Your period is expected around today"
          : `Your period is ${days} days later than expected. Cycles shift for all sorts of reasons.`;
    return { text, href: "/patient/cycle" };
  }
  if (n.template === "finance_posting_failed") {
    // From private.finance_record_posting_failure(). A payment landed but its
    // general-ledger entry did not post, most often because the accounting
    // period had already been closed. The money is real and the purchase is
    // active; only the books are short, so this needs an accountant today,
    // not a clinician now.
    const code = String(payload.error_code ?? "");
    return {
      text:
        code === "23514"
          ? "A payment could not be posted to the ledger: its accounting period is closed"
          : "A payment could not be posted to the ledger and needs a look",
      href: "/finance/ledger",
    };
  }
  if (n.template === "payment_integrity_flag_raised") {
    // From private.record_payment_integrity_flag(). An activation was REFUSED
    // because what was charged did not match what was owed, or because the
    // event carried no provider reference. The purchase is deliberately still
    // unactivated, so somebody has paid and is waiting.
    const flagType = String(payload.flag_type ?? "");
    return {
      text:
        flagType === "amount_mismatch"
          ? "A payment was refused because the amount did not match what was owed"
          : "A payment could not be matched to what it was paying for",
      href: "/finance/reconciliation",
    };
  }
  if (n.template === "payment_reconciliation_flags_open") {
    // From the daily reconcile-payment-providers cron. Paystack and this
    // platform disagree about something and nobody has resolved it yet.
    const count = Number(payload.open_count ?? 0);
    return {
      text:
        count === 1
          ? "1 payment discrepancy is waiting to be reviewed"
          : `${count} payment discrepancies are waiting to be reviewed`,
      href: "/finance/reconciliation",
    };
  }
  if (n.template === "support_view_as_started") {
    // From private.notify_support_view_session_started() (support view-as,
    // 20260922175144_support_view_as.sql) — sent to the SUBJECT (a patient or
    // a clinician, never the viewer), so unlike most templates here this one
    // has no single role-specific href to link into; "/" is the one existing
    // role-agnostic entry point (proxy.ts redirects "/" to getRoleHomePath()
    // for a signed-in user on the app host), so it resolves correctly either
    // way instead of hardcoding /patient for a clinician subject too.
    const viewerName = String(payload.viewer_name ?? "A member of the Tarragon Health support team");
    const reason = String(payload.reason ?? "");
    return {
      text: reason
        ? `${viewerName} opened a support view of your account: "${reason}"`
        : `${viewerName} opened a support view of your account`,
      href: "/",
    };
  }
  return { text: "You have an update", href: "/patient" };
}
