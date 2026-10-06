/**
 * S24: a referral cannot sit open forever. `chase_due_at` is the date the care team is reminded to follow it up; this puts it in words
 * for the lists a clinician already uses. Pure: the caller passes `now`. Africa/Lagos calendar dates, per the platform rule.
 */
const CLOSED_STATUSES = new Set(["draft", "declined", "closed", "completed"]);

function lagosDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

export function chaseLabel(referral: { status: string; chase_due_at: string | null }, now: Date): string | null {
  if (CLOSED_STATUSES.has(referral.status) || !referral.chase_due_at) return null;
  const due = new Date(referral.chase_due_at);
  if (Number.isNaN(due.getTime())) return null;
  const readable = due.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
  if (lagosDay(due) < lagosDay(now)) return `Follow-up was due ${readable}`;
  return `Follow up by ${readable}`;
}
