import type { ActivePage, Readiness } from "./page-api";

/**
 * Words and small decisions for the On call screen (S19e). Pure. Every string is fixed and neutral (INV-07): no condition, reading,
 * number or name can appear on this screen or in a notification it causes, because none is ever read here.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The weekly self-test prompt shows one day before the test page would stop counting for on-call readiness (never less than a day old). */
export function selfTestDue(readiness: Readiness, nowMs: number): boolean {
  if (!readiness.lastTestPageAcknowledgedAt) return true;
  const last = Date.parse(readiness.lastTestPageAcknowledgedAt);
  if (!Number.isFinite(last)) return true;
  const promptAfterDays = Math.max(1, readiness.testPageDays - 1);
  return nowMs - last >= promptAfterDays * DAY_MS;
}

const GAP_LABELS: Readonly<Record<string, string>> = {
  push_subscription: "Notifications are not set up on a phone for your account. Allow notifications in this app.",
  verified_email: "Your email address is not confirmed. Pages are also sent by email.",
  test_page: "You have not acknowledged a test page recently.",
};

export function gapLabel(code: string): string {
  return GAP_LABELS[code] ?? "Something about your set-up needs attention. Ask the clinical lead.";
}

export function waitingLabel(seconds: number): string {
  if (seconds < 60) return "Waiting less than a minute";
  const m = Math.floor(seconds / 60);
  return m === 1 ? "Waiting 1 minute" : `Waiting ${m} minutes`;
}

export type PageTone = "danger" | "warn" | "positive" | "neutral";

export interface PageCard {
  readonly title: string;
  readonly status: string;
  readonly tone: PageTone;
  readonly canAcknowledge: boolean;
}

/** One card for one page row. `expired` means the whole ladder ran out; a late acknowledgement is still accepted. */
export function pageCard(p: ActivePage): PageCard {
  const title = p.role === "escalation" ? "A priority case has not been picked up" : "A priority case needs you";
  if (p.acknowledged) return { title, status: "Acknowledged. Open the clinician console to continue.", tone: "positive", canAcknowledge: false };
  if (p.expired) return { title, status: "Nobody has answered yet. Acknowledge it now.", tone: "danger", canAcknowledge: true };
  return { title, status: waitingLabel(p.secondsWaiting), tone: p.secondsWaiting >= 300 ? "danger" : "warn", canAcknowledge: true };
}

/** What the screen says when a call fails. The raw database message is never shown: it can carry internal names. */
export function failureText(error: string): string {
  if (/not been shown/i.test(error)) return "The test page has not reached this phone yet. Wait for the notification, open it, then try again.";
  if (/wait a little/i.test(error)) return "A test page was sent a moment ago. Wait a little before sending another.";
  if (/not authori[sz]ed|42501/i.test(error)) return "This account cannot do that. Ask the clinical lead.";
  return "That did not work. Check your connection and try again.";
}
