import type { SupabaseClient } from "@supabase/supabase-js";
import { getProposedConfig, type Database } from "@tarragon/shared";
import { ANCHOR_IDS, buildAnchorProfile, type AnchorId, type AnchorProfile, type AnchorSlotRow, type AnchorTimeRow, type DayShiftRow } from "@tarragon/medicines";

/**
 * The patient's anchor times and "my day has shifted" entries (S08z), read for the web. Anchored doses resolve against this, in
 * the same package the phone uses, so the page and the phone show the same time. Until a profile is read, or if it cannot be,
 * the proposed starting times alone are used: an anchored dose still shows at a sensible time instead of vanishing.
 */
export interface DoseAnchorConfig {
  version: number;
  defaults: Record<AnchorId, string>;
  /** Offsets (minutes, 0 = with it, negative = before) offered beside an anchor. */
  offsetChoices: readonly number[];
  /** What is offered for "move this part of my day by". */
  shiftOffsetChoices: readonly number[];
  maxShiftDays: number;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function doseAnchorConfig(): DoseAnchorConfig {
  // The dated lookup first; a server or browser clock behind the effective date takes the latest version rather than failing.
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
    const time = anchors?.[id];
    if (typeof time !== "string" || !TIME_RE.test(time)) throw new Error(`medicines.dose_anchors.anchors.${id} is not a time`);
    defaults[id] = time;
  }
  const wholeList = (name: string): number[] => {
    const v = raw[name];
    if (!Array.isArray(v) || v.length === 0 || v.some((o) => typeof o !== "number" || !Number.isInteger(o))) {
      throw new Error(`medicines.dose_anchors.${name} must be a list of whole minutes`);
    }
    return v as number[];
  };
  const days = raw.max_shift_days;
  if (typeof days !== "number" || !Number.isInteger(days) || days <= 0) throw new Error("medicines.dose_anchors.max_shift_days is not a positive whole number");
  return {
    version: entry.version,
    defaults,
    offsetChoices: wholeList("offset_choices_minutes"),
    shiftOffsetChoices: wholeList("shift_offset_choices_minutes"),
    maxShiftDays: days,
  };
}

/** The proposed starting times alone: what anchored doses resolve against until the person's own are known. */
export function defaultsProfile(): AnchorProfile {
  return { slots: {}, defaults: doseAnchorConfig().defaults, times: {}, shifts: [] };
}

export interface LoadedAnchors {
  profile: AnchorProfile;
  timeRows: AnchorTimeRow[];
  shiftRows: DayShiftRow[];
  slotRows: AnchorSlotRow[];
  /** False when the person's own times could not be read: the profile is then the proposed starting times only. */
  loaded: boolean;
}

/** Reads a person's anchors and shifts with their own session (row level security keeps it to them and the people allowed to act for them). Never throws. */
export async function loadAnchors(supabase: SupabaseClient<Database>, patientId: string): Promise<LoadedAnchors> {
  try {
    const [times, shifts, slots] = await Promise.all([
      supabase.from("patient_dose_anchors").select("anchor, effective_from, local_time").eq("patient_id", patientId),
      supabase.from("patient_day_shifts").select("id, starts_on, ends_on, offsets, cancelled_from, created_at").eq("patient_id", patientId),
      supabase.from("patient_dose_anchor_slots").select("slot, anchor").eq("patient_id", patientId),
    ]);
    if (times.error || shifts.error || slots.error) return { profile: defaultsProfile(), timeRows: [], shiftRows: [], slotRows: [], loaded: false };
    const timeRows = (times.data ?? []) as AnchorTimeRow[];
    const slotRows = (slots.data ?? []) as AnchorSlotRow[];
    const shiftRows = ((shifts.data ?? []) as { id: string; starts_on: string; ends_on: string; offsets: unknown; cancelled_from: string | null; created_at: string }[]).map(
      (s) => ({ ...s, offsets: (typeof s.offsets === "object" && s.offsets !== null ? s.offsets : {}) as Record<string, number> })
    );
    return { profile: buildAnchorProfile(doseAnchorConfig().defaults, timeRows, shiftRows, slotRows), timeRows, shiftRows, slotRows, loaded: true };
  } catch {
    return { profile: defaultsProfile(), timeRows: [], shiftRows: [], slotRows: [], loaded: false };
  }
}
