/**
 * Words for the employer seat pilot screens (docs/design/EMP.md). English only (decision D-14).
 *
 * Rules held by employer-pilot-copy.test.ts: no em dashes; "your care team" never "your doctor"; no claim of outcomes, savings or
 * return on spend; nothing that says an employer can see a person's health. The employer terms and the employee notice are drafts that
 * still need counsel (docs/legal/employer-pilot-terms-DRAFT.md), so the words here describe what the product does and promise nothing
 * beyond it.
 */
export const employerPilotCopy = {
  "pilot.title": "Membership seat pilot",
  "pilot.intro":
    "A block of Membership seats for the people you employ. Each person who joins from your roster takes one seat. Seats are paid for in one invoice.",
  "pilot.none": "There is no seat pilot for your organisation yet. Your Tarragon contact can set one up.",
  "pilot.privacy":
    "You see counts only. You never see anyone's health information, what they discussed with their care team, or any reading or result. Your roster still shows who has joined, as it does today. Small groups are not reported: a figure for fewer people than the minimum is withheld.",
  "pilot.seats.heading": "Seats",
  "pilot.usage.heading": "How the seats are being used",
  "pilot.usage.suppressed":
    "Not enough members have joined yet to report usage without pointing at individuals. This section appears when enough have joined.",
  "pilot.usage.note": "Counts are rounded to the nearest {rounded} and cover the weeks completed up to {through}. A figure for fewer than {min} people is withheld.",
  "pilot.withheld": "Withheld",
  "pilot.export.csv": "Download as CSV",
  "pilot.export.print": "Print or save as PDF",
  "pilot.waiting.heading": "Claims waiting for a seat",
  "pilot.waiting.body":
    "These are people on your roster who joined but did not get a seat yet, because the invoice is unpaid, every purchased seat is taken, or the claim window has closed. Your Tarragon contact can help.",
  "pilot.unclaimed.body": "Seats not claimed by the end of the claim window lapse. They are not carried over or refunded.",
  "pilot.state.draft": "Being set up",
  "pilot.state.invoiced": "Invoice issued, waiting for payment",
  "pilot.state.active": "Active",
  "pilot.state.ended": "Ended",
  "pilot.state.cancelled": "Cancelled",
} as const;

export type EmployerPilotCopyKey = keyof typeof employerPilotCopy;

export function employerPilotText(key: EmployerPilotCopyKey, params?: Record<string, string | number>): string {
  let text: string = employerPilotCopy[key];
  for (const [k, v] of Object.entries(params ?? {})) text = text.split(`{${k}}`).join(String(v));
  return text;
}
