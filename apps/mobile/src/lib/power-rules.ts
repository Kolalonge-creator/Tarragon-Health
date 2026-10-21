import type { Connection } from "./media-policy";

/**
 * Power-cut and low-battery behaviour (S06y). Pure decisions, no I/O, so every caller asks the same
 * question and the rules are tested once.
 *
 * The one rule that matters most: SAVING a reading and sending an urgent or essential entry are never
 * delayed by battery or data settings. Only work a person did not just ask for (a bulk pull from a
 * health store, a bulk upload of old sample pages) may wait, and it waits visibly: the person is told
 * their entries are saved on the phone and will send later.
 */
export interface PowerState {
  /** 0 to 100, or null when this build cannot read it. */
  batteryPercent: number | null;
  /** The phone's own battery saver (Android) or Low Power Mode (iOS), or null when unknown. */
  batterySaver: boolean | null;
  /** Plugged in, or null when unknown. A phone on a charger is not short of power. */
  charging: boolean | null;
}

export const UNKNOWN_POWER: PowerState = { batteryPercent: null, batterySaver: null, charging: null };

export type WorkKind =
  /** Writing a reading, symptom or dose to the phone. Never deferred. */
  | "save_entry"
  /** Sending a danger-flagged entry. Never deferred. */
  | "send_urgent"
  /** Sending a normal outbox entry, a device reading or a photo-read number (a few hundred bytes each). Never deferred. */
  | "send_essential"
  /** Reading from a health store and uploading its queued sample pages (large; nobody is waiting on it). May wait. */
  | "upload_bulk";

export type DeferReason = "low_power" | "low_data";

export type WorkDecision = { action: "run" } | { action: "defer"; reason: DeferReason };

/** True when the phone is short of power: its battery saver is on, or the level is at or under the line and it is not charging. */
export function isLowPower(power: PowerState, lowBatteryPercent: number): boolean {
  if (power.charging === true) return false;
  if (power.batterySaver === true) return true;
  return power.batteryPercent !== null && power.batteryPercent <= lowBatteryPercent;
}

export interface WorkContext {
  work: WorkKind;
  power: PowerState;
  lowBatteryPercent: number;
  /** The patient's low-data mode (S34). */
  lowData: boolean;
  connection: Connection;
}

export function workDecision(ctx: WorkContext): WorkDecision {
  if (ctx.work === "save_entry" || ctx.work === "send_urgent" || ctx.work === "send_essential") return { action: "run" };
  if (isLowPower(ctx.power, ctx.lowBatteryPercent)) return { action: "defer", reason: "low_power" };
  // Same stance as media-policy.ts: a connection that is not known to be Wi-Fi counts as metered.
  if (ctx.work === "upload_bulk" && ctx.lowData && ctx.connection !== "wifi") return { action: "defer", reason: "low_data" };
  return { action: "run" };
}
