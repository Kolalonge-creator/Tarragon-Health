/**
 * S58b. A one-shot hand-off from the points screen to the Technical support screen, so "ask our team to take a look" opens the form
 * with a calm, ready-to-send note. The text comes from the shared copy catalogue (never from outside the app) and is taken once:
 * reading it clears it, so it never reappears on a later visit.
 */
export interface SupportPrefill {
  subject: string;
  description: string;
}

let pending: SupportPrefill | null = null;

export function setSupportPrefill(value: SupportPrefill): void {
  pending = value;
}

export function takeSupportPrefill(): SupportPrefill | null {
  const v = pending;
  pending = null;
  return v;
}
