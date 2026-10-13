/**
 * The safety drill, step by step. The Chief Medical Officer works through it with a test account and ticks what actually happened.
 * The last step may be skipped with a note, so a pass needs the first five.
 */
export const DRILL_STEPS = [
  "Post the Chief Medical Officer's signed test self-harm phrase in a live group, as a test member.",
  "Confirm the post is withheld from the group and the member sees the self-harm card.",
  "Confirm the post is in the safety queue and not in the moderator queue.",
  "Confirm a safety reviewer can see it and a moderator cannot.",
  "Confirm the member's own emergency button works (it is never automatic) and that nothing was sent to the member's contacts without a tap.",
  "Confirm the overdue notice reaches the safety reviewer if the post is left for 30 minutes (or write in the notes why you skipped this step).",
] as const;
/** A pass needs this many steps ticked, counted from the top. */
export const DRILL_REQUIRED_STEPS = 5;
export const DRILL_NOTES_MAX = 2000;
