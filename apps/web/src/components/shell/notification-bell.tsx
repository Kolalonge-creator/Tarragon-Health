"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICON } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import {
  useInAppNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type InAppNotification,
} from "@/lib/queries/notifications";

/** Renders each in-app template's payload as a short line + a link to where
 * it's actually acted on. Add a case here for every new in_app template —
 * anything unmapped still shows (generic text, dashboard link) rather than
 * silently disappearing from the bell. */
function describe(n: InAppNotification): { text: string; href: string } {
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
  if (n.template === "clinician_new_referral") {
    const specialist = String(payload.specialist_type ?? "a specialist").replace(/_/g, " ");
    return {
      text: `New referral to triage: ${specialist}`,
      href: "/clinician/referrals",
    };
  }
  if (n.template === "clinician_referral_outcome_received") {
    const specialist = String(payload.specialist_type ?? "a specialist").replace(/_/g, " ");
    const referralId = String(payload.referral_id ?? "");
    return {
      text: `Specialist outcome came back: ${specialist}`,
      href: referralId ? `/clinician/referrals/${referralId}` : "/clinician/referrals",
    };
  }
  if (n.template === "referral_closed") {
    const specialist = String(payload.specialist_type ?? "your specialist").replace(/_/g, " ");
    return {
      text: `Your ${specialist} referral is closed — your care plan was updated`,
      href: "/patient",
    };
  }
  if (n.template === "referral_reminder") {
    const specialist = String(payload.specialist_type ?? "your specialist").replace(/_/g, " ");
    return {
      text: `Don't forget your ${specialist} referral — bring back what they find`,
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
  if (n.template === "health_reset_complete") {
    return {
      text: "Your 90-Day Health Reset is complete: claim your free trial",
      href: "/patient",
    };
  }
  if (n.template === "video_visit_alternate_proposed") {
    return {
      text: "Your doctor offered a different time for your video visit: pick one",
      href: "/patient/care",
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
  if (n.template === "medication_refill_reminder") {
    const drug = String(payload.drug_name ?? "your medication");
    return {
      text: `Refill reminder: ${drug} is due soon`,
      href: "/patient/medications",
    };
  }
  if (n.template === "medication_adherence_checkin") {
    const drug = String(payload.drug_name ?? "your medication");
    const checkinCopy: Record<string, string> = {
      started: `Have you started taking ${drug}?`,
      side_effects: `Any side effects from ${drug}?`,
      missed_doses: `How many doses of ${drug} have you missed?`,
      lab_review: `Time for a follow-up on ${drug}`,
    };
    const checkinType = String(payload.checkin_type ?? "");
    return {
      text: checkinCopy[checkinType] ?? `A check-in for ${drug} is due`,
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
  if (n.template === "reward_voucher_issued") {
    const label = String(payload.label ?? "A reward");
    const value = String(payload.value_naira ?? "");
    return {
      text: value ? `${label}: a ₦${value} voucher toward your care` : `${label} added to your account`,
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
      text: `${name} hasn't logged a reading in ${days} days; a call might help`,
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
  if (n.template === "critical_notification_escalation_exhausted") {
    // From private.escalate_unconfirmed_critical_notifications() —
    // every channel in a critical alert's ladder (push -> whatsapp -> sms)
    // ran out with nobody confirming it. Admin-only visibility surface;
    // the underlying clinical SLA/worklist safety net is unaffected either
    // way, this is purely "a notification chain needs a human look."
    const sourceTable = String(payload.source_table ?? "");
    return {
      text: "A critical alert went unconfirmed on every channel: needs a look",
      href: sourceTable === "clinician_alerts" ? "/clinician/escalations" : "/admin",
    };
  }
  if (n.template === "result_interpretation_ready") {
    return {
      text: "A doctor sent you an interpretation of a lab result you uploaded",
      href: "/patient/labs",
    };
  }
  if (n.template === "free_tier_reading_self_care_suggestion") {
    // From private.raise_dangerous_reading_ai_suggestion() / assess-glucose.ts
    // raiseGlucoseAlert() — the Tarragon Free alternative to doctor escalation
    // for a dangerous vitals/symptom reading (20260810120000_gate_vitals_red_
    // flag_escalation_to_paid_plans.sql). Deterministic self-care copy, not a
    // doctor's assessment — the full text lives in payload.self_care_note so
    // it can be specific to what was actually flagged.
    const vital = String(payload.vital_label ?? "a reading");
    return {
      text: `${vital}: ${String(payload.self_care_note ?? "please take a moment to check on this.")}`,
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
    const test = String(payload.test_name ?? "your test");
    const lab = String(payload.lab_name ?? "the lab");
    return { text: `Your order for ${test} at ${lab} is confirmed`, href: "/patient/labs" };
  }
  if (n.template === "lab_order_requested_patient") {
    const test = String(payload.test_name ?? "a lab test");
    const selfBooked = payload.self_booked === true;
    return {
      text: selfBooked
        ? `${test} is ready: take it to your chosen lab`
        : `${test} has been requested for you`,
      href: "/patient/labs",
    };
  }
  if (n.template === "medication_prescribed_patient") {
    const drug = String(payload.drug_name ?? "A medication");
    return { text: `${drug} was prescribed for you`, href: "/patient/medications" };
  }
  if (n.template === "pharmacy_order_patient_confirmation") {
    const items = String(payload.items_summary ?? "your medication");
    return { text: `Your pharmacy order is confirmed: ${items}`, href: "/patient/pharmacy" };
  }
  if (n.template === "referral_patient_confirmation") {
    const specialist = String(payload.specialist_name ?? "your specialist");
    return { text: `Your referral to ${specialist} is confirmed`, href: "/patient/referrals" };
  }
  if (n.template === "result_document_available") {
    return { text: "A new lab result document is available", href: "/patient/labs" };
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
    const service = String(payload.service_type ?? "your appointment");
    const days = Number(payload.days_before ?? 0);
    return {
      text: days > 0 ? `${service} is coming up in ${days} day${days === 1 ? "" : "s"}` : `${service} is coming up`,
      href: "/patient/care",
    };
  }
  if (n.template === "care_outreach_checkin") {
    return { text: "Your care team wants to check in with you", href: "/patient" };
  }
  if (n.template === "diabetes_complication_check_due") {
    const checkType = String(payload.check_type ?? "complication");
    return { text: `Your ${checkType} check is due`, href: "/patient/care" };
  }
  if (n.template === "health_check_due_soon") {
    const bundle = String(payload.bundle_name ?? "your health check");
    return { text: `${bundle} is due again soon`, href: "/patient/health-check" };
  }
  if (n.template === "health_check_rebook_due") {
    const bundle = String(payload.bundle_name ?? "your health check");
    return { text: `Time to rebook ${bundle}`, href: "/patient/health-check" };
  }
  if (n.template === "lifestyle_review_due") {
    return { text: "Your lifestyle review is due", href: "/patient/lifestyle" };
  }
  if (n.template === "medication_review_due") {
    return { text: "Your medication review is due", href: "/patient/medications" };
  }
  if (n.template === "preventive_review_due") {
    return { text: "Your preventive review is due", href: "/patient/prevention" };
  }
  if (n.template === "screening_due") {
    const screen = String(payload.screen_type_name ?? "A screening");
    return { text: `${screen} is due`, href: "/patient/prevention" };
  }
  if (n.template === "vaccination_due") {
    const vaccine = String(payload.vaccine_name ?? "A vaccination");
    return { text: `${vaccine} is due`, href: "/patient/prevention" };
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
    const condition = String(payload.condition ?? "a condition").replace(/_/g, " ");
    return {
      text: `We're now tracking ${condition} for you too. Complete Care adds a scheduled review for it`,
      href: "/patient/subscription",
    };
  }
  return { text: "You have an update", href: "/patient" };
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Reads the `notifications` table's in_app channel — see lib/queries/notifications.ts
 * for why this exists (the channel and its RLS predate any UI that showed it). */
export function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { data } = useInAppNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const items = data ?? [];
  const unread = items.filter((n) => n.status === "pending");

  const openItem = (n: InAppNotification) => {
    if (n.status === "pending") markRead.mutate(n.id);
    setOpen(false);
    router.push(describe(n).href);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="relative h-9 w-9 p-0 text-charcoal-ink/60 hover:text-charcoal-ink"
        aria-label={unread.length > 0 ? `Notifications, ${unread.length} unread` : "Notifications"}
        onClick={() => setOpen((v) => !v)}
      >
        <NAV_ICON.bell className="h-5 w-5" strokeWidth={2} />
        {unread.length > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-green px-1 text-[10px] font-semibold text-white"
          >
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-charcoal-ink/10 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-charcoal-ink/10 px-4 py-2.5">
            <p className="text-sm font-semibold text-charcoal-ink">Notifications</p>
            {unread.length > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-brand-green hover:underline"
                onClick={() => markAllRead.mutate(unread.map((n) => n.id))}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-charcoal-ink/50">
                No notifications yet.
              </p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10">
                {items.map((n) => {
                  const { text } = describe(n);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={cn(
                          "flex w-full items-start gap-2 px-4 py-3 text-left text-sm hover:bg-charcoal-ink/[0.03]",
                          n.status === "pending" && "bg-brand-green/[0.04]"
                        )}
                      >
                        {n.status === "pending" && (
                          <span
                            aria-hidden
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-charcoal-ink">{text}</span>
                          <span className="mt-0.5 block text-xs text-charcoal-ink/50">
                            {timeAgo(n.created_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
