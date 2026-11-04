/**
 * Care Circle for family abroad: the marketing copy for the home page and /parentcare section.
 *
 * Every line maps to something live in the patient app on 2026-11-03 (see the patient Care Circle pages and the
 * `circle.*` strings in packages/i18n):
 * - the person chooses who joins and each item each person may see (circle.perm.*), can pause sharing (circle.pause.*)
 *   and remove anyone (circle.member.remove);
 * - shared items: weekly blood pressure averages, never single readings (circle.perm.weekly_bp_trend); doses taken out
 *   of doses due with no medicine names (circle.view.adherence.line); next appointment and missed ones
 *   (circle.perm.appointments); a monthly summary (circle.monthly.*); a check-in request when the care team sees
 *   something urgent or the person taps for help, which names the person and never what happened (circle.preview.alert,
 *   circle.help.*);
 * - family can pay for a Membership, which the person accepts (circle.gift.*);
 * - every look is recorded and the person sees who looked (circle.log.*).
 *
 * Deliberately NOT claimed: whether blood pressure is "on target" or "controlled", any doctor:patient ratio, any
 * response time, WhatsApp. The doctor's monthly note is not live yet and appears only as "Coming soon".
 * The section quotes no price; the gift link goes to /gift, which reads the price from versioned config.
 */

export const CARE_CIRCLE_ABROAD = {
  eyebrow: "For family abroad",
  title: "Follow a parent's care from wherever you live",
  description:
    "Care Circle lets the person you care about share a short, limited summary of their care with the family members they choose. You see enough to know how they are doing, and they stay in charge of their own record.",
} as const;

export interface CareCircleItem {
  readonly title: string;
  readonly body: string;
}

/** What a family member may see, item by item, once the person has allowed it. */
export const CARE_CIRCLE_SHARED: readonly CareCircleItem[] = [
  {
    title: "Blood pressure, as weekly averages",
    body: "An average for each week, and whether it is higher, lower or about the same as the week before. Single readings are never shown.",
  },
  {
    title: "Medicines, as doses taken",
    body: "How many doses were taken out of the doses due that week. The names of the medicines are not shown.",
  },
  {
    title: "Appointments",
    body: "The date of the next appointment, and any appointments missed in the last 30 days.",
  },
  {
    title: "A monthly summary",
    body: "A short month-by-month report of the items already shared, if they choose to send it.",
  },
  {
    title: "A request to check on them",
    body: "If their care team sees something urgent, or they tap to ask for help, you receive a message straight away asking you to call them. It tells you that they need a call, not what happened.",
  },
];

/** How the person keeps control. */
export const CARE_CIRCLE_CONTROL: readonly CareCircleItem[] = [
  {
    title: "They choose who joins",
    body: "They invite each person and decide, item by item, what that person may see.",
  },
  {
    title: "They can pause or remove anyone",
    body: "Sharing can be paused for a while, or a person removed, at any time and without giving a reason.",
  },
  {
    title: "Every look is recorded",
    body: "Each time someone opens their summary it is logged, and they can see who looked and when.",
  },
];

export const CARE_CIRCLE_GIFT = {
  title: "You can also give them a year of Membership",
  body: "Pay once, from abroad, and they decide whether to accept it. Paying for their care does not give you any extra access to their health information.",
  linkLabel: "See how giving a Membership works",
} as const;

/** The only not-yet-live item this section may mention, and only with this label. */
export const CARE_CIRCLE_COMING_SOON =
  "Coming soon: a short note from their care team after each monthly video call.";

/**
 * Illustrative data for the supporter-view mock. Obviously an example (a made-up name, a labelled "Illustration"),
 * shaped exactly like the live supporter view: weekly averages with a reading count, doses taken out of doses due,
 * the next appointment and missed count, and a check-in request that names the person and nothing else.
 */
export const CARE_CIRCLE_ILLUSTRATION = {
  name: "Adaeze",
  sharedUntil: "Shared with you until 30 November",
  weeks: [
    { label: "29 Sep", systolic: 142, diastolic: 90 }, // band-ok: illustrative reading on the marketing page, not a threshold
    { label: "6 Oct", systolic: 139, diastolic: 88 }, // band-ok: illustrative reading on the marketing page, not a threshold
    { label: "13 Oct", systolic: 137, diastolic: 88 }, // band-ok: illustrative reading on the marketing page, not a threshold
    { label: "20 Oct", systolic: 135, diastolic: 86 }, // band-ok: illustrative reading on the marketing page, not a threshold
    { label: "27 Oct", systolic: 134, diastolic: 85 }, // band-ok: illustrative reading on the marketing page, not a threshold
    { label: "3 Nov", systolic: 134, diastolic: 84 }, // band-ok: illustrative reading on the marketing page, not a threshold
  ],
  latestReadings: 6,
  dosesTaken: 12,
  dosesDue: 14,
  nextAppointment: "Thursday 13 November, 10:00",
  missedLast30Days: 0,
} as const;
