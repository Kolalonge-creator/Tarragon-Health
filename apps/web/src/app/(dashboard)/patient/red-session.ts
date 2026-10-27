/**
 * W-53 / D-03: once someone has acknowledged a red or emergency state, nothing on the following calm screens may ask them to buy anything
 * for the rest of the session. The acknowledgement writes this flag; the Membership offer reads it. Storage can be blocked, in which case the
 * answer is "yes, acknowledged" (the offer stays hidden), never the reverse.
 */
const KEY = "tarragon.red_acknowledged";

export function markRedAcknowledgedThisSession(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    /* nothing to do: the offer also checks the live emergency query */
  }
}

export function redAcknowledgedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}
