/**
 * Care Circle Phase 5 (2026-11-04): what a person who paid for someone's care sees about that payment (`circlep5.`), and the admin
 * metrics page (`circlep5.admin.`). English only.
 *
 * Approved as written by the founder acting as CMO and DPO, in chat, 2026-11-04 (docs/DECISIONS.md CC-COPY-P5), separately from
 * CC-COPY and CC-COPY-P4. Any change to a string here needs a fresh review.
 *
 * Rules held by tests: no em dashes; never "doctor-led" or "your doctor"; no WhatsApp; no condition, reading or medicine named.
 */
export const circleP5Copy = {
  "circlep5.paid.title": "Membership you paid for",
  "circlep5.paid.privacy": "Paying for someone's care does not let you see their health information. They choose what to share.",
  "circlep5.paid.row": "{item} for {name}",
  "circlep5.paid.paid_on": "Paid on {date}",
  "circlep5.paid.waiting": "Waiting for {name} to accept",
  "circlep5.paid.accepted": "Active until {date}",
  "circlep5.paid.renew_soon": "Ends on {date}. You can give another year whenever you are ready.",
  "circlep5.paid.declined": "{name} said no, thank you",
  "circlep5.paid.not_answered": "{name} did not answer in time",
  "circlep5.paid.not_accepted": "Not taken up",
  "circlep5.paid.refund": "Refund: {state}",
  "circlep5.paid.renew": "Give another year",
  "circlep5.admin.title": "Care Circle",
  "circlep5.admin.intro": "Counts only, without test accounts. No names and nothing clinical.",
  "circlep5.admin.adoption": "Adoption",
  "circlep5.admin.engagement": "Engagement (last 30 days)",
  "circlep5.admin.commercial": "Gifts",
  "circlep5.admin.safety": "Safety and privacy",
  "circlep5.admin.patients_with_circle": "Patients with a Care Circle",
  "circlep5.admin.active_supporters": "Active family members",
  "circlep5.admin.invites_sent": "Invitations sent",
  "circlep5.admin.invites_accepted": "Invitations accepted",
  "circlep5.admin.patients_with_two_or_more": "Patients with two or more family members",
  "circlep5.admin.supporters_of_two_or_more": "Family members supporting two or more people",
  "circlep5.admin.supporters_who_looked_30d": "Family members who looked",
  "circlep5.admin.doctor_notes_released_30d": "Notes from the care team shared",
  "circlep5.admin.help_requests_30d": "Help requests",
  "circlep5.admin.help_requests_done_30d": "Help requests done",
  "circlep5.admin.gifts_paid": "Gifts paid",
  "circlep5.admin.gifts_accepted": "Accepted",
  "circlep5.admin.gifts_waiting": "Waiting",
  "circlep5.admin.gifts_declined": "Declined",
  "circlep5.admin.gifts_not_answered": "Not answered in time",
  "circlep5.admin.gift_revenue_kobo": "Revenue from accepted gifts",
  "circlep5.admin.removed_30d": "Family members removed (30 days)",
  "circlep5.admin.paused_now": "Circles paused now",
  "circlep5.admin.help_alerts_30d": "Help alerts sent (30 days)",
  "circlep5.admin.error": "We could not load these figures.",
  // approved separately on 2026-11-04 (CC-COPY-P5b): what the person who paid sees when the circle filled up before they said yes
  "circlep5.offer.full": "{name}'s Care Circle is full at the moment, so you cannot join yet. Nothing has been shared. {name} can make room by removing someone or cancelling an invite.",
} as const;

export type CircleP5CopyKey = keyof typeof circleP5Copy;

export const CIRCLE_P5_COPY_REVIEW = {
  status: "cmo_reviewed",
  reviewer: "Kola Longe, Chief Medical Officer and DPO (approved in chat)",
  reviewedOn: "2026-11-04",
  owner: "CMO",
  also: "DPO",
  source: "supabase/migrations/20261104214130_care_circle_p5_payer_view_and_metrics.sql",
  prefixes: ["circlep5."],
} as const;
