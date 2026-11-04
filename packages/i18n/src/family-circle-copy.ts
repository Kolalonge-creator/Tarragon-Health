/**
 * Words for two Care Circle additions (2026-11-03): sharing with the person who paid for a gift (`giftshare.`), and the doctor's short
 * line for the family (`familynote.`). English only. Care Circle Phase 1 (2026-11-04) added `circlep1.`: the help button while paused,
 * the payer's accept/decline step (founder decision D3), and the patient's history of sharing changes.
 *
 * EVERY STRING IN THIS FILE IS PROPOSED COPY AWAITING CMO AND DPO REVIEW. The permission label and the "share" step are consent wording.
 * They sit under their own prefixes, not `circle.`, so the reviewed-strings ledger (whose baseline can only shrink) does not have to
 * grow; FAMILY_CIRCLE_COPY_REVIEW below is the marker and nobody but the CMO marks anything reviewed.
 *
 * Rules held by tests: no em dashes; never "doctor-led"; no WhatsApp; no condition, reading or medicine named; nothing pre-ticked is
 * implied ("Share the usual" says exactly what it ticks).
 */
export const familyCircleCopy = {
  // --- sharing with the person who paid (gift acceptance, and later from the Care Circle page)
  "giftshare.title": "Would you like {name} to see how you are doing?",
  "giftshare.intro": "{name} paid for your care. You can let them see a little of how you are doing. Nothing is shared until you choose, and you can change or stop it at any time.",
  "giftshare.someone": "the person who paid",
  "giftshare.legend": "Choose what they can see",
  "giftshare.monthly": "My monthly report",
  "giftshare.usual": "Share the usual",
  "giftshare.usual_hint": "The usual is: your weekly blood pressure trend, doses taken, appointments, a message asking them to check on you if you need help, and your monthly report.",
  "giftshare.share": "Share what I ticked",
  "giftshare.not_now": "Not now",
  "giftshare.nothing_ticked": "Tick at least one thing, or choose Not now.",
  "giftshare.saving": "Saving",
  "giftshare.done": "Done. We have asked {name} to join your Care Circle. They see nothing until they say yes, and you can change or stop this any time.",
  "giftshare.waiting": "Waiting for {name} to say yes.",
  "giftshare.not_now_done": "Nothing was shared, and we will not ask again. You can still invite them to your Care Circle at any time.",
  "giftshare.error": "That could not be saved, so nothing was shared. Please try again.",
  "giftshare.error_full": "Your Care Circle is full. Remove someone first, then try again.",
  "giftshare.later_title": "People who paid for your care",
  "giftshare.later_body": "They see nothing about your health unless you choose.",
  "giftshare.later_open": "Choose what {name} can see",
  "giftshare.loading": "Loading the people who paid for your care",

  // --- the doctor's line for the family
  "familynote.perm": "A short line from the doctor for my family after a consultation, once I have read it and chosen to share it (never results, diagnoses or medicine names)",
  "familynote.view.title": "A note from the doctor",
  "familynote.view.none": "No note yet. After a consultation, the doctor may write a short line for the family.",
  "familynote.view.from": "From {name}",
  "familynote.view.from_team": "From your care team",
  "familynote.view.written": "Written {date}",
  // --- the patient's own card: every note reaches the patient first; nothing reaches family until the patient shares that note
  "familynote.mine.title": "A note from the doctor for your family",
  "familynote.mine.intro": "After your consultation, the doctor wrote this short line for the people who support you. Nobody else sees it unless you choose to share it.",
  "familynote.mine.private": "Only you can see this",
  "familynote.mine.shared": "Shared with your Care Circle",
  "familynote.mine.who": "If you share it, only the people you have allowed to see a line from the doctor will read it. You can stop sharing at any time.",
  "familynote.mine.share": "Share with my Care Circle",
  "familynote.mine.dont_share": "Don't share",
  "familynote.mine.stop": "Stop sharing",
  "familynote.mine.earlier": "An earlier note your Care Circle can still see",
  "familynote.mine.shared_done": "Shared. People you allowed to see a line from the doctor can now read it.",
  "familynote.mine.unshared_done": "Not shared. Only you can see it.",
  "familynote.mine.error": "That could not be saved. Nothing changed. Please try again.",
  "familynote.mine.loading": "Loading the note from the doctor",
  "familynote.form.title": "A line for the family",
  "familynote.form.optional": "Optional",
  "familynote.form.label": "Write one short line the family can read",
  "familynote.form.hint": "Plain words. No results, diagnoses or medicine names.",
  "familynote.form.who": "The patient reads it first. Their family sees it only if the patient chooses to share it, and only the latest shared line.",
  "familynote.form.count": "{used} of {max} characters",
  "familynote.form.save": "Save the line",
  "familynote.form.saving": "Saving",
  "familynote.form.saved": "Saved. The patient will see it first and can choose to share it with their family.",
  "familynote.form.empty": "Write something first, or leave this blank.",
  "familynote.form.too_long": "Keep it to {max} characters.",
  "familynote.form.not_allowed": "Only the doctor who held this consultation can write this, once it has finished.",
  "familynote.form.error": "That could not be saved. Please try again.",
  "circlep1.help.paused_warning": "Your Care Circle is paused. If you press this, it will still reach the people who can receive alerts.",
  "circlep1.help.sent_paused": "Your circle is paused, but this alert was still sent.",
  "circlep1.offer.title": "{name} has asked you to join their Care Circle",
  "circlep1.offer.body": "You paid for their care, and they would like you to see a little of how they are doing. Nothing is shown to you until you say yes, and they can change or stop it at any time.",
  "circlep1.offer.answer_by": "Please answer by {date}.",
  "circlep1.offer.accept": "Yes, join",
  "circlep1.offer.decline": "No, thank you",
  "circlep1.offer.accepted": "You have joined {name}'s Care Circle.",
  "circlep1.offer.declined": "You said no. Nothing will be shared with you.",
  "circlep1.offer.error": "That did not work. Please try again.",
  "circlep1.offers.title": "Waiting for a reply",
  "circlep1.offers.row": "{name}, until {date}",
  "circlep1.offers.withdraw": "Withdraw",
  "circlep1.history.title": "Changes to sharing",
  "circlep1.history.empty": "No changes yet.",
  "circlep1.history.error": "We could not load this just now.",
  "circlep1.history.added": "{name} joined your Care Circle",
  "circlep1.history.offered": "You asked {name} to join",
  "circlep1.history.accepted": "{name} said yes",
  "circlep1.history.declined": "{name} said no",
  "circlep1.history.permissions_changed": "What {name} can see was changed",
  "circlep1.history.renewed": "{name}'s access was extended",
  "circlep1.history.revoked": "{name} was removed",
  "circlep1.history.left": "{name} left your Care Circle",
  "circlep1.history.expired": "{name}'s access ended",
  "circlep1.history.monthly_report_on": "{name} can see your monthly summary",
  "circlep1.history.monthly_report_off": "{name} no longer sees your monthly summary",
  "circlep1.history.missed_dose_alert_on": "{name} will be nudged about missed doses",
  "circlep1.history.missed_dose_alert_off": "{name} will no longer be nudged about missed doses",
  "circlep1.history.paused": "You paused sharing",
  "circlep1.history.resumed": "Sharing started again",
  "circlep1.history.doctor_note_shared": "You shared a doctor's note with your circle",
  "circlep1.history.doctor_note_withdrawn": "You stopped sharing a doctor's note",
  "circlep1.history.someone": "A supporter",
} as const;

export type FamilyCircleCopyKey = keyof typeof familyCircleCopy;

export const FAMILY_CIRCLE_COPY_REVIEW = {
  status: "pending_cmo_review",
  owner: "CMO",
  also: "DPO (consent wording)",
  source: "supabase/migrations/20261103230825_family_doctor_note.sql, 20261103230906_circle_share_with_gift_payer.sql, 20261104172930_care_circle_p1_consent_pause_rls_history.sql, 20261104180415_care_circle_p1_payer_accepts_and_note_waiting.sql",
  prefixes: ["giftshare.", "familynote.", "circlep1."],
} as const;

/** The longest line a doctor may write for the family. The database CHECK says the same (1 to 280 characters). */
export const FAMILY_NOTE_MAX = 280;
