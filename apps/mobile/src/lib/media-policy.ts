/**
 * What the app may fetch or play without being asked (S34, spec section 11 and D.1).
 * A pure decision function, so every screen asks the same question and the rules are
 * tested once. No React, no network, no storage.
 *
 * Rules:
 * - Audio never starts by itself. It plays on tap, in or out of low-data mode.
 * - Low-data mode: no image loads by itself, video is tap only.
 * - A download of on-demand audio or video needs Wi-Fi unless the patient allowed
 *   mobile data for downloads. An unknown connection counts as not Wi-Fi: the
 *   cost of waiting is a tap, the cost of guessing wrong is the patient's data bundle.
 * - Emergency guidance (INV-06) is bundled in the app and is never gated by any of this.
 */
export type MediaKind = "image" | "audio" | "video" | "download";
export type Connection = "wifi" | "cellular" | "unknown";

export interface MediaContext {
  kind: MediaKind;
  lowData: boolean;
  connection: Connection;
  /** Patient chose to allow downloads on mobile data (off by default). */
  allowCellularDownloads?: boolean;
  /** Bundled emergency content: always allowed, nothing to fetch. */
  emergency?: boolean;
}

export type MediaDecision =
  | { action: "load" }
  /** Show a placeholder and a clear control; load when the patient taps it. */
  | { action: "tap" }
  /** Offer the download only once the phone is on Wi-Fi. */
  | { action: "wait_for_wifi" };

export function mediaDecision(ctx: MediaContext): MediaDecision {
  if (ctx.emergency) return { action: "load" };
  switch (ctx.kind) {
    case "audio":
    case "video":
      return { action: "tap" };
    case "image":
      return ctx.lowData ? { action: "tap" } : { action: "load" };
    case "download":
      return ctx.connection === "wifi" || ctx.allowCellularDownloads ? { action: "load" } : { action: "wait_for_wifi" };
  }
}

/**
 * A tap is the patient asking, so it loads. A download still respects the Wi-Fi
 * rule even when asked, unless the patient has allowed mobile data.
 */
export function mediaDecisionAfterTap(ctx: MediaContext): MediaDecision {
  if (ctx.kind === "download") return mediaDecision(ctx);
  return { action: "load" };
}
