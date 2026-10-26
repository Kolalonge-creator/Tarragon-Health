import { getProposedConfig } from "@tarragon/shared";
import { ANCHOR_IDS, type AnchorId } from "@tarragon/medicines";

/**
 * S08z values from the versioned registry (packages/shared/src/proposed-config, key medicines.dose_anchors). Call sites take
 * this object and never a literal. The starting times are placeholders the patient confirms; nothing is computed from
 * location or a calendar.
 */
export interface DoseAnchorConfig {
  version: number;
  /** The proposed starting time for each anchor. A time the patient chose always wins. */
  defaults: Record<AnchorId, string>;
  /** The offsets (minutes; 0 = with it, negative = before) the phone offers beside an anchor. */
  offsetChoices: readonly number[];
  /** What the phone offers for "move this part of my day by", in minutes (0 is no change). */
  shiftOffsetChoices: readonly number[];
  /** The longest a "my day has shifted" entry may run, in days. */
  maxShiftDays: number;
  /** The furthest one anchor may be moved by a shift, in minutes either way. */
  maxShiftOffsetMinutes: number;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function loadDoseAnchorConfig(): DoseAnchorConfig {
  // The dated lookup first; a phone whose clock runs behind the effective date takes the latest version instead of failing.
  let entry;
  try {
    entry = getProposedConfig("medicines.dose_anchors");
  } catch {
    entry = getProposedConfig("medicines.dose_anchors", "9999-12-31");
  }
  const raw = entry.value as Record<string, unknown>;
  const anchors = raw.anchors as Record<string, unknown> | undefined;
  const defaults = {} as Record<AnchorId, string>;
  for (const id of ANCHOR_IDS) {
    const t = anchors?.[id];
    if (typeof t !== "string" || !TIME_RE.test(t)) throw new Error(`medicines.dose_anchors.anchors.${id} is not a time`);
    defaults[id] = t;
  }
  const wholeList = (name: string): number[] => {
    const v = raw[name];
    if (!Array.isArray(v) || v.length === 0 || v.some((o) => typeof o !== "number" || !Number.isInteger(o))) {
      throw new Error(`medicines.dose_anchors.${name} must be a list of whole minutes`);
    }
    return v as number[];
  };
  const offsets = wholeList("offset_choices_minutes");
  const whole = (name: string): number => {
    const n = raw[name];
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) throw new Error(`medicines.dose_anchors.${name} is not a positive whole number`);
    return n;
  };
  return {
    version: entry.version,
    defaults,
    offsetChoices: offsets,
    shiftOffsetChoices: wholeList("shift_offset_choices_minutes"),
    maxShiftDays: whole("max_shift_days"),
    maxShiftOffsetMinutes: whole("max_shift_offset_minutes"),
  };
}
