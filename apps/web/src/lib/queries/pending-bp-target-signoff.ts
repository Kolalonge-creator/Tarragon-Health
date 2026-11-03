import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** What the sign-off panel shows, read from the version itself so the targets the CMO signs are the targets that will apply. */
export type BpTargetView = {
  home: { systolic: number; diastolic: number };
  clinic: { systolic: number; diastolic: number };
  minReadingsPerPerson: number;
  restMinutes: number;
  /** Which target each kind of reading is judged against, e.g. diary -> home, pharmacy -> clinic. */
  contexts: { context: string; target: "home" | "clinic" }[];
};

export type PendingBpTargetSignoff = {
  /** An unsigned version newer than the one in force, waiting for the CMO. */
  version: number | null;
  view: BpTargetView | null;
  /** The signed version in force, if any. */
  liveVersion: number | null;
  /** What a monthly home average is judged against today, read from the database so the sign-off text never hard-codes it. */
  currentDefault: { systolic: number; diastolic: number } | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

const FAILED: PendingBpTargetSignoff = { version: null, view: null, liveVersion: null, currentDefault: null, failed: true };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** Pure: the panel view from a version's config, or null when something it must show is missing (the panel then refuses to offer Sign). */
export function bpTargetView(config: unknown): BpTargetView | null {
  if (!isObj(config) || !isObj(config.targets) || !isObj(config.grade) || !isObj(config.contextToTarget)) return null;
  const { home, clinic } = config.targets;
  if (!isObj(home) || !isObj(clinic)) return null;
  const hs = int(home.systolic), hd = int(home.diastolic), cs = int(clinic.systolic), cd = int(clinic.diastolic);
  const minReadings = int(config.grade.minReadingsPerPerson), rest = int(config.grade.restMinutes);
  if (hs === null || hd === null || cs === null || cd === null || minReadings === null || rest === null) return null;
  const contexts: BpTargetView["contexts"] = [];
  for (const [context, target] of Object.entries(config.contextToTarget)) {
    if (target !== "home" && target !== "clinic") return null;
    contexts.push({ context, target });
  }
  return { home: { systolic: hs, diastolic: hd }, clinic: { systolic: cs, diastolic: cd }, minReadingsPerPerson: minReadings, restMinutes: rest, contexts };
}

/**
 * What the blood pressure targets (D-09) need from the Chief Medical Officer, for the sign-off hub. Read through
 * public.bp_target_config_for_signoff(), the only read path (the table is closed to every user role). Nothing signs by itself. Never throws.
 */
export async function readPendingBpTargetSignoff(supabase: SupabaseClient<Database>): Promise<PendingBpTargetSignoff> {
  try {
    const { data, error } = await supabase.rpc("bp_target_config_for_signoff");
    if (error || !isObj(data)) return FAILED;
    const live = isObj(data.live) ? int(data.live.version) : null;
    const pending = isObj(data.pending) ? data.pending : null;
    const version = pending ? int(pending.version) : null;
    const d = isObj(data.current_default) ? data.current_default : null;
    const ds = d ? int(d.systolic) : null, dd = d ? int(d.diastolic) : null;
    return {
      version,
      view: pending && version !== null ? bpTargetView(pending.config) : null,
      liveVersion: live,
      currentDefault: ds !== null && dd !== null ? { systolic: ds, diastolic: dd } : null,
      failed: false,
    };
  } catch {
    return FAILED;
  }
}
