import type { AudioIssue } from "@tarragon/audio";

/**
 * Non-fatal audio problems (spec 8.8: "if a clip is missing, show the text and log a non-fatal error").
 * Kept in memory for the session and written to the console in development. There is no Sentry in the mobile
 * app yet (OQ-20); when there is, `reportAudioIssue` is the one place to forward these. It never throws.
 */
const MAX_KEPT = 50;
const kept: AudioIssue[] = [];

export function reportAudioIssue(issue: AudioIssue): void {
  kept.push(issue);
  if (kept.length > MAX_KEPT) kept.shift();
  if (__DEV__) console.warn(`[audio] ${issue.code} ${issue.clipId ?? ""} ${issue.lang ?? ""} ${issue.detail ?? ""}`.trim());
}

export const recentAudioIssues = (): readonly AudioIssue[] => [...kept];
export const clearAudioIssues = (): void => {
  kept.length = 0;
};
