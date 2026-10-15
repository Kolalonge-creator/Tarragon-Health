/**
 * S85-D3: SMS is allowed only for phone verification codes (Supabase phone auth), clinician paging, and the one guarded,
 * content-free alert to a patient's own emergency contact. No screen that writes to patients, employees or partners may queue
 * an SMS. The sender refuses one anyway; this makes the screens and mutations refuse it first, with a clear message, rather than
 * queueing a row that is later suppressed where nobody sees it.
 */
export const SMS_CHANNEL_REMOVED_MESSAGE =
  "SMS is not available for announcements or invitations. Use email, in-app or a link you share yourself.";

/** Throws if a channel list names SMS. Use at the mutation boundary, so a stale tab or a crafted call cannot queue one. */
export function assertNoSmsChannel(channels: readonly string[]): void {
  if (channels.some((c) => c.toLowerCase() === "sms")) throw new Error(SMS_CHANNEL_REMOVED_MESSAGE);
}
