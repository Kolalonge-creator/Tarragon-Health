import type { ShiftStartTest } from "./schemas";

/** What the clinician sees for one start-of-shift test page: a badge, a headline and what to do. Pure, so it is tested without a screen. */
export type ShiftTestView = {
  badge: "green" | "amber" | "red";
  headline: string;
  instructions: string[];
  canAcknowledge: boolean;
};

const ROLE_LABEL = { primary: "primary", backup: "backup" } as const;

export function describeShiftTest(t: ShiftStartTest): ShiftTestView {
  const role = ROLE_LABEL[t.role];
  if (t.state === "acknowledged") {
    return { badge: "green", headline: `You are confirmed as ${role} for this shift.`, instructions: [], canAcknowledge: false };
  }
  if (t.undelivered) {
    // the test page did not reach this person: say so plainly and say what to do. The On call screen records its own receipt, so a
    // page that shows here can still be acknowledged below.
    return {
      badge: "red",
      headline: t.state === "missed" ? `The test page never reached you and the shift is not counted as covered.` : `The test page has not reached you yet.`,
      instructions: [
        "Check that notifications are on for Tarragon Health and that battery saving is off for it.",
        "Check mobile data or Wi-Fi, and look in your email for the test page.",
        "If this screen shows the page below, tap the button: that proves this screen works. Then fix your phone settings before the shift.",
        "If nothing works, phone the clinical lead now and ask for a swap or for cover.",
      ],
      // the On call screen records its own receipt when it shows the page, so a clinician whose push route is dead can still confirm here
      canAcknowledge: true,
    };
  }
  if (t.state === "missed") {
    return {
      badge: "red",
      headline: `The shift was not counted as covered because the test page was not acknowledged in time. Acknowledge it now to restore cover.`,
      instructions: [],
      canAcknowledge: true,
    };
  }
  return { badge: "amber", headline: `Test page sent. Tap the button to confirm you received it as ${role} for this shift.`, instructions: [], canAcknowledge: true };
}

/** Plain seconds-to-text for the latency line. */
export function formatLatency(seconds: number | null): string {
  if (seconds === null) return "not recorded";
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

export const CHANNEL_LABEL: Record<string, string> = { push: "phone notification", in_app: "this screen", alarm: "on-call alarm" };
