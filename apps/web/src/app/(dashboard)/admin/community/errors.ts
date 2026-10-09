/**
 * Turns a raised database error into a calm English sentence. The database says WHY in its own words (a trigger message), which is
 * written for engineers; none of it is ever shown. Every branch below returns a fixed sentence of ours. Anything unknown becomes the
 * generic line.
 */
export type DbError = { message: string; code?: string };

const GENERIC = "That could not be done. Please try again.";

const BY_MESSAGE: ReadonlyArray<readonly [RegExp, string]> = [
  [/need the current Chief Medical Officer approval before it goes live/i, "This group's rules need the Chief Medical Officer's approval before it can go live. Ask the Chief Medical Officer to approve them in the clinician area, then try again."],
  [/safety rules can only be activated by an active Chief Medical Officer/i, "A version with emergency or self-harm rules can only be made live by the Chief Medical Officer."],
  [/cannot go live without blocking phone numbers/i, "A version must keep blocking phone numbers, email addresses, links and handles before it can go live."],
  [/needs an approver to go live/i, "This version cannot go live yet because it has no approver."],
  [/can only be activated by an admin or the Chief Medical Officer/i, "Only an admin or the Chief Medical Officer can make a version live."],
  [/only a draft rule set can be activated/i, "Only a draft can be made live."],
  [/rules can change only while their rule set is a draft/i, "Only a draft can be changed."],
  [/only the Chief Medical Officer can remove the rules approval/i, "Only the Chief Medical Officer can turn off the need for approval of group rules on a topic."],
  [/only the Chief Medical Officer (writes|removes) emergency and self-harm rules/i, "Emergency and self-harm rules are written and removed by the Chief Medical Officer only, in the clinician area."],
  [/live community group needs rules/i, "A live group needs rules text."],
  [/archived/i, "An archived group is final and cannot be changed."],
  [/created as a draft/i, "A new group always starts as a draft."],
  [/(granted to )?an active (admin or )?care coordinator account/i, "Only an active care coordinator account can be given a community permission. Admin accounts cannot."],
  [/only an admin grants/i, "Only an admin can give or end these permissions."],
  [/admins only|admins and the Chief Medical Officer only/i, "Only an admin can do that."],
  [/sign in required/i, "Please sign in again."],
];

export function friendlyDbError(error: DbError | null | undefined): string {
  if (!error) return GENERIC;
  for (const [re, text] of BY_MESSAGE) if (re.test(error.message)) return text;
  switch (error.code) {
    case "28000":
      return "Please sign in again.";
    case "42501":
      return "You do not have permission to do that.";
    case "23505":
      return "That already exists. Please choose a different name or code.";
    case "23514":
    case "22023":
    case "22P02":
    case "23502":
      return "One of the values is not allowed. Please check the form and try again.";
    default:
      return GENERIC;
  }
}
