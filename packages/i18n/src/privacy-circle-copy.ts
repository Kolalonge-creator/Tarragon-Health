/**
 * Words for the "Who can see this" screen, the "Hide on this phone" switch, the gentler Care Circle check-in wording and the cohorts
 * empty / could-not-load states (UI-B, from docs/research/S66-S70-design-ui-comparison.md changes 5, 6, 13 and 14). English only (D-14).
 * Keys are namespaced `uib.`.
 *
 * EVERY STRING HERE IS PROPOSED COPY AWAITING CMO AND DPO REVIEW (OQ-UIB-1). The privacy lines state what a person can and cannot
 * see; they are only allowed to say what is true on screen today, and each one names a limit rather than hiding it. Nobody but the
 * CMO or DPO marks anything reviewed; this file never does.
 *
 * Rules held by tests: no em dashes; "your care team", never "your doctor"; none of these strings is ever sent as a notification.
 */
export const privacyCircleCopy = {
  // --- Who can see this (change 5)
  "uib.who.title": "Who can see this",
  "uib.who.intro": "Here is who can see what you log in this section, and what you can and cannot change.",
  "uib.who.only_me.title": "Only me",
  "uib.who.only_me.body": "What you log is saved to your account. If you set a PIN for this section, it also asks for that PIN each time you open it on this phone.",
  "uib.who.care_team.title": "My care team",
  "uib.who.care_team.body": "A member of your care team who looks after you can open a short summary when they need it. Each time is written in the list below. You cannot switch this off here yet.",
  "uib.who.circle.title": "People I choose",
  "uib.who.circle.body": "Nobody in your Care Circle can see this unless you add them and give them access to this section. You can take that access away at any time.",
  "uib.who.preview.title": "What someone in your Care Circle would see",
  "uib.who.preview.none": "If you have not given them access to this section: nothing from it.",
  "uib.who.preview.granted": "If you give them access: they can see what you log in this section, for example your period days and how you felt.",
  "uib.who.preview.notifications": "Reminders and messages from this section never say what they are about, on your screen or on theirs.",
  "uib.who.limit": "A limit to know about: anyone who has your login can see this section. A PIN on this phone helps if the phone is shared, but it is not a full lock.",
  "uib.who.link": "Choose who is in your Care Circle",

  // --- Hide on this phone (change 6)
  "uib.hide.action": "Hide on this phone",
  "uib.hide.hidden": "This card is hidden on this phone.",
  "uib.hide.show": "Show again",
  "uib.hide.note": "This only hides the card on this phone. It does not delete anything and it does not change who else can see it.",

  // --- Care Circle check-in (change 13)
  "uib.checkin.snooze": "Not right now",
  "uib.checkin.again_title": "No problem. Want to answer now?",
  "uib.checkin.again_body": "Tap the button so they know you are well.",
  "uib.checkin.limit_note": "If the question runs out before you answer, the people in your Care Circle who receive check-in requests may be told.",

  // --- Cohorts (change 14)
  "uib.cohorts.empty": "You are not in a group yet. Create one below, or open an invite link someone sent you.",
  "uib.cohorts.empty_button": "Create a group",
  "uib.cohorts.load_failed": "We could not load your groups just now. This is not the same as having none.",
} as const;

export const PRIVACY_CIRCLE_COPY_REVIEW = {
  status: "pending_cmo_dpo_review",
  owner: "CMO and DPO",
  prefixes: ["uib."],
} as const;
