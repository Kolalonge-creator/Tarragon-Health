/**
 * The Free plan, described once for the public pricing page and the in-app Membership page (patient dashboard 2.0, spec 15.1),
 * so the two can never disagree about what costs nothing.
 */
export const FREE_PLAN = {
  name: "Free",
  priceLine: "No cost, no card, no time limit",
  summary: "The app, including health tracking, reminders, education and guidance.",
  includes: [
    "Record your readings and see your trends",
    "Reminders and the screening calendar",
    "The full education library",
    "Urgent-care guidance if a reading or symptom looks serious",
  ],
} as const;
