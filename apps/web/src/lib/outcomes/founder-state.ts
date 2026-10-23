import type { FounderView } from "./dashboard-report";

/** What the founder view's form action hands back to the page: nothing, a refusal in words, or the figures (never stored, never downloadable). */
export type FounderState =
  | { status: "idle" }
  | { status: "error"; message: "off" | "refused" | "reason" | "failed" }
  | { status: "ok"; view: FounderView };

export const FOUNDER_IDLE: FounderState = { status: "idle" };
