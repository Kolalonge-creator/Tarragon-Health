import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

/** What the sign-off panel shows, read from the draft itself so the rule the CMO signs is the rule that will apply. */
export type BaselineLabsRuleView = {
  appliesTo: string;
  groups: { label: string; medicines: string[] }[];
  groupsNote: string;
  requiredForAll: string[];
  requiredIfDiabetes: string[];
  requiredForGlucoseLowering: string[];
  overrideReasons: string[];
  overrideWho: string;
  diabetesNote: string;
  windowDays: number;
  windowNote: string;
  whenMissing: string;
  bypassNote: string;
  membershipNote: string;
  proposedNote: string;
};

export type PendingBaselineLabsRuleSignoff = {
  /** An unsigned, inactive baseline_labs_rule_config version newer than the one in force. */
  version: number | null;
  rule: BaselineLabsRuleView | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null; config?: unknown };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

const FAILED: PendingBaselineLabsRuleSignoff = { version: null, rule: null, failed: true };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

/** A medicine pattern like "%losartan%" shown as the plain name. */
const plain = (p: string) => p.replace(/%/g, "").trim();

/** Pure: the panel view from a draft's config, or null when something it must show is missing (the panel then says nothing rather than guess). */
export function baselineLabsRuleView(config: unknown): BaselineLabsRuleView | null {
  if (!isObj(config)) return null;
  const { applies_to: at, drug_classes: dc, required_baseline: rb, when_labs_are_missing: wm, informational: info } = config;
  if (!isObj(at) || !isObj(dc) || !isObj(rb) || !isObj(wm) || !isObj(info)) return null;
  const bp = dc.bp_lowering;
  const gl = dc.glucose_lowering;
  if (!isObj(bp) || !isObj(gl)) return null;
  const bpNames = strings(bp.name_patterns);
  const glNames = strings(gl.name_patterns);
  const all = strings(rb.for_every_medicine_in_both_groups);
  const dm = strings(rb.additionally_if_diabetes_on_record);
  const gl2 = strings(rb.additionally_for_every_glucose_lowering_medicine);
  const analytes = rb.analytes;
  const dmRec = rb.diabetes_on_record;
  if (!bpNames || !glNames || !all || !dm || !gl2 || !isObj(analytes) || !isObj(dmRec)) return null;
  const label = (k: string): string | null => {
    const a = analytes[k];
    return isObj(a) && typeof a.label === "string" ? a.label : null;
  };
  const allLabels = all.map(label);
  const dmLabels = dm.map(label);
  const glLabels = gl2.map(label);
  if (allLabels.includes(null) || dmLabels.includes(null) || glLabels.includes(null)) return null;
  const ov = wm.override;
  if (!isObj(ov) || !Array.isArray(ov.categories) || typeof ov.who !== "string") return null;
  const reasons: string[] = [];
  for (const c of ov.categories) {
    if (!isObj(c) || typeof c.label !== "string") return null;
    reasons.push(c.label);
  }
  if (reasons.length === 0) return null;
  if (typeof bp.label !== "string" || typeof gl.label !== "string" || typeof dc.note !== "string") return null;
  if (typeof at.note !== "string" || typeof config.recency_window_days !== "number" || typeof config.recency_window_note !== "string") return null;
  if (typeof wm.message !== "string" || typeof wm.bypass_note !== "string" || wm.bypass_available !== true) return null;
  if (typeof info.membership !== "string" || typeof config.proposed_note !== "string" || typeof dmRec.note !== "string") return null;
  return {
    appliesTo: at.note,
    groups: [
      { label: bp.label, medicines: bpNames.map(plain) },
      { label: gl.label, medicines: glNames.map(plain) },
    ],
    groupsNote: dc.note,
    requiredForAll: allLabels as string[],
    requiredIfDiabetes: dmLabels as string[],
    requiredForGlucoseLowering: glLabels as string[],
    overrideReasons: reasons,
    overrideWho: ov.who,
    diabetesNote: dmRec.note,
    windowDays: config.recency_window_days,
    windowNote: config.recency_window_note,
    whenMissing: wm.message,
    bypassNote: wm.bypass_note,
    membershipNote: info.membership,
    proposedNote: config.proposed_note,
  };
}

/**
 * What the baseline-labs prescribing rule needs from the Chief Medical Officer, for the sign-off hub. Nothing signs by itself: the draft stays
 * inactive until the CMO presses the sign control, and until then the prescribing check does nothing for anyone. Never throws.
 */
export async function readPendingBaselineLabsRuleSignoff(supabase: SupabaseClient<Database>): Promise<PendingBaselineLabsRuleSignoff> {
  try {
    const res = await (supabase as unknown as Loose).from("baseline_labs_rule_config").select("version, is_active, approved_at, config");
    if (res.error || !res.data) return FAILED;
    const version = newestWaiting(res.data);
    return { version, rule: version === null ? null : baselineLabsRuleView(res.data.find((r) => r.version === version)?.config), failed: false };
  } catch {
    return FAILED;
  }
}
