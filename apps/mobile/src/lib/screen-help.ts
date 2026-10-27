import { AUDIO_SCRIPTS, type MessageKey } from "@tarragon/i18n";
import { HLP_CLIPS, type HelpScreen } from "@tarragon/audio";
import type { SectionId } from "./sections";

/**
 * "What is this?" for a screen, and the first-use tour of a tab (spec D.2). Pure: no I/O, no clock.
 *
 * The help text is the written script of the screen's planned audio clip (packages/i18n audio-scripts, the same words a recording would
 * say), so the written and spoken help can never differ, and a person with no sound or no recording still gets it. A screen is mapped
 * ONLY where its script clearly describes it; a screen with no entry shows no help row at all, rather than a script about a different
 * screen. Adding a screen here is a one-line change and the test checks the clip exists.
 */
export const SECTION_HELP: Partial<Record<SectionId, HelpScreen>> = {
  overview: "today",
  vitals: "quick_log",
  bpHistory: "trends",
  medications: "medicines",
  passport: "health_passport",
  shareRecords: "share_records",
  labs: "test_results",
  healthReport: "health_report",
  devices: "connected_devices",
  privacy: "privacy_settings",
  directory: "find_care",
  // Deliberately NOT mapped, though a script with a similar name exists: "meals" (HLP-032 describes picking portions like a plate or a spoon;
  // the meal log is written in words) and "learn" (HLP-029 says to tap a play button; that is only true where a lesson has audio).
};

/** The written help for a section, or null when it has none mapped (or the script is missing). */
export function helpTextFor(section: SectionId): string | null {
  const screen = SECTION_HELP[section];
  if (!screen) return null;
  return AUDIO_SCRIPTS[HLP_CLIPS[screen]]?.en ?? null;
}

/** The tabs that get a first-use tour: the four bottom tabs the app really has (lib/sections.ts), not the seven the old scripts assumed. */
export const TOUR_TABS = ["overview", "vitals", "medications", "messages"] as const;
export type TourTab = (typeof TOUR_TABS)[number];

export const TOUR_BODY_KEYS: Record<TourTab, MessageKey> = {
  overview: "tour.overview.body",
  vitals: "tour.vitals.body",
  medications: "tour.medications.body",
  messages: "tour.messages.body",
};

export function isTourTab(section: SectionId): section is TourTab {
  return (TOUR_TABS as readonly string[]).includes(section);
}

/** The tour to OFFER on opening this section: only a tour tab, only once. Never autoplayed or forced. */
export function tourToOffer(section: SectionId, seen: ReadonlySet<string>): TourTab | null {
  return isTourTab(section) && !seen.has(section) ? section : null;
}

export const TOURS_SEEN_KEY = "@tarragon/tours-seen/v1";

/** A stored value that cannot be read means "none seen", so the worst case is one extra offer, never a hidden tour. */
export function parseSeen(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && (TOUR_TABS as readonly string[]).includes(x)) : []);
  } catch {
    return new Set();
  }
}

export function serializeSeen(seen: ReadonlySet<string>): string {
  return JSON.stringify([...seen].sort());
}
