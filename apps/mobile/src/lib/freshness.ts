import { getProposedConfig } from "@tarragon/shared";
import type { MessageKey } from "@tarragon/i18n";

/**
 * How old is the copy of the record kept on the phone (S06y). Pure: no I/O, no clock of its own, so every branch is
 * unit tested. The threshold is a PROPOSED value in the versioned registry (key offline.freshness), never a literal.
 *
 * Wording rules: calm, no fear words, English only (packages/i18n), never "your doctor". Below the threshold the
 * screen only says when the copy was last updated; past it, it adds that the copy may be out of date and how to
 * refresh it. A time the app cannot trust (missing, unreadable, or in the future by more than a few minutes because
 * the phone clock moved) is treated as unknown, which is worded as cautiously as "old".
 */
export interface FreshnessConfig {
  version: number;
  staleAfterMs: number;
}

export function loadFreshnessConfig(): FreshnessConfig {
  const entry = getProposedConfig<{ readonly [k: string]: number }>("offline.freshness");
  const hours = entry.value.stale_after_hours;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) throw new Error("offline.freshness.stale_after_hours is not a positive number");
  return { version: entry.version, staleAfterMs: hours * 3_600_000 };
}

/** A small clock difference between phone and server must not turn "just now" into "unknown". */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

export type FreshnessLevel = "recent" | "stale" | "unknown";

export interface FreshnessMessage {
  key: MessageKey;
  params?: Record<string, number>;
}

export interface Freshness {
  level: FreshnessLevel;
  /** Age of the copy, or null when it cannot be told. */
  ageMs: number | null;
  /** Always present: when the copy was last updated, in words (or that this cannot be told). */
  label: FreshnessMessage;
  /** Present only when the copy is stale or its age is unknown. */
  notice: FreshnessMessage | null;
}

function agoMessage(ageMs: number): FreshnessMessage {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return { key: "freshness.just_now" };
  if (minutes < 60) return { key: minutes === 1 ? "freshness.minute_one" : "freshness.minute_other", params: { count: minutes } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: hours === 1 ? "freshness.hour_one" : "freshness.hour_other", params: { count: hours } };
  const days = Math.floor(hours / 24);
  return { key: days === 1 ? "freshness.day_one" : "freshness.day_other", params: { count: days } };
}

export interface FreshnessCopy {
  /** The "last updated" line. */
  label: string;
  /** The calm "may be out of date" line, or null while the copy is recent. */
  notice: string | null;
  /** Screen reader text for the label: says it is a saved copy, then when it was updated. */
  labelA11y: string;
}

/** Turns an assessment into text with a translate function, so the wording lives in packages/i18n only. */
export function freshnessCopy(f: Freshness, translate: (key: MessageKey, params?: Record<string, number>) => string): FreshnessCopy {
  const label = translate(f.label.key, f.label.params);
  return {
    label,
    notice: f.notice ? translate(f.notice.key, f.notice.params) : null,
    labelA11y: `${translate("freshness.a11y_prefix")} ${label}`,
  };
}

export function assessFreshness(lastUpdatedAt: string | null | undefined, nowMs: number, config: FreshnessConfig): Freshness {
  const unknown: Freshness = {
    level: "unknown",
    ageMs: null,
    label: { key: "freshness.unknown" },
    notice: { key: "freshness.unknown_notice" },
  };
  if (!lastUpdatedAt) return unknown;
  const at = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return unknown;
  const age = nowMs - at;
  if (age < -CLOCK_SKEW_TOLERANCE_MS) return unknown; // a time in the future: the phone clock cannot be trusted
  const ageMs = Math.max(0, age);
  if (ageMs >= config.staleAfterMs) {
    return { level: "stale", ageMs, label: agoMessage(ageMs), notice: { key: "freshness.may_be_old" } };
  }
  return { level: "recent", ageMs, label: agoMessage(ageMs), notice: null };
}
