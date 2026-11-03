/**
 * Words for two Care Circle additions (2026-11-03): sharing with the person who paid for a gift (`giftshare.`), and the doctor's short
 * line for the family (`familynote.`). English only.
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
  "giftshare.done": "Done. {name} can now see what you chose. You can change or stop this any time in your Care Circle.",
  "giftshare.not_now_done": "Nothing was shared. You can do this later from your Care Circle.",
  "giftshare.error": "That could not be saved, so nothing was shared. Please try again.",
  "giftshare.error_full": "Your Care Circle is full. Remove someone first, then try again.",
  "giftshare.later_title": "People who paid for your care",
  "giftshare.later_body": "They see nothing about your health unless you choose.",
  "giftshare.later_open": "Choose what {name} can see",
  "giftshare.loading": "Loading the people who paid for your care",

  // --- the doctor's line for the family
  "familynote.perm": "A short line from the doctor for my family after a consultation (never results, diagnoses or medicine names)",
  "familynote.view.title": "A note from the doctor",
  "familynote.view.none": "No note yet. After a consultation, the doctor may write a short line for the family.",
  "familynote.view.from": "From {name}",
  "familynote.view.from_team": "From your care team",
  "familynote.view.written": "Written {date}",
  "familynote.form.title": "A line for the family",
  "familynote.form.optional": "Optional",
  "familynote.form.label": "Write one short line the family can read",
  "familynote.form.hint": "Plain words. No results, diagnoses or medicine names.",
  "familynote.form.who": "Only people the patient has chosen to share it with will see it, and only the latest line.",
  "familynote.form.count": "{used} of {max} characters",
  "familynote.form.save": "Save the line",
  "familynote.form.saving": "Saving",
  "familynote.form.saved": "Saved. The family will see this line if the patient shares it with them.",
  "familynote.form.empty": "Write something first, or leave this blank.",
  "familynote.form.too_long": "Keep it to {max} characters.",
  "familynote.form.not_allowed": "Only the doctor who held this consultation can write this, once it has finished.",
  "familynote.form.error": "That could not be saved. Please try again.",
} as const;

export type FamilyCircleCopyKey = keyof typeof familyCircleCopy;

export const FAMILY_CIRCLE_COPY_REVIEW = {
  status: "pending_cmo_review",
  owner: "CMO",
  also: "DPO (consent wording)",
  source: "supabase/migrations/20261103230825_family_doctor_note.sql, 20261103230906_circle_share_with_gift_payer.sql",
  prefixes: ["giftshare.", "familynote."],
} as const;

/** The longest line a doctor may write for the family. The database CHECK says the same (1 to 280 characters). */
export const FAMILY_NOTE_MAX = 280;
