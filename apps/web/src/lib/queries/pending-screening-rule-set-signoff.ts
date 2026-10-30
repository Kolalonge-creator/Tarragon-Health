import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** The key the screening rule set line carries on the sign-off hub, so the page can attach the signing form. */
export const SCREENING_RULE_SET_ITEM_KEY = "screening_rule_set";

export type ScreeningPacing = { maxNewRequestsPerWeek: number; priority: { code: string; name: string }[] };

export type PendingScreeningRuleSet = {
  /** An unsigned, inactive version newer than the signed one in force, or null when nothing waits. */
  draftId: string | null;
  version: number | null;
  liveVersion: number | null;
  /** The pacing block the draft adds, read from the draft itself so what is signed is what will apply. */
  pacing: ScreeningPacing | null;
  /**
   * The draft's rules are exactly the signed version's rules and it adds a valid pacing block. Only then can it be signed from the hub; a draft
   * that changes the rules themselves is shown but not offered for signing here.
   */
  signable: boolean;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { id: string; version: number; is_active: boolean; approved_by: string | null; config: unknown };
type Loose = {
  from(table: string): {
    select(columns: string): PromiseLike<{ data: unknown[] | null; error: unknown }> & {
      in(column: string, values: string[]): PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

const NONE: PendingScreeningRuleSet = { draftId: null, version: null, liveVersion: null, pacing: null, signable: false, failed: false };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pure: the pending draft from the rule set rows and the names of the screen types, or "nothing waiting". */
export function pendingFromRows(rows: Row[], names: Record<string, string>): PendingScreeningRuleSet {
  const live = rows.filter((r) => r.is_active && r.approved_by !== null).sort((a, b) => b.version - a.version)[0];
  const draft = rows.filter((r) => !r.is_active && r.approved_by === null && (!live || r.version > live.version)).sort((a, b) => b.version - a.version)[0];
  if (!draft) return NONE;
  const dc = isObj(draft.config) ? draft.config : {};
  const p = isObj(dc.pacing) ? dc.pacing : null;
  const max = p && typeof p.maxNewRequestsPerWeek === "number" && Number.isInteger(p.maxNewRequestsPerWeek) && p.maxNewRequestsPerWeek > 0 ? p.maxNewRequestsPerWeek : null;
  const codes = p && Array.isArray(p.priority) && p.priority.every((c) => typeof c === "string") ? (p.priority as string[]) : null;
  const pacing = max !== null && codes !== null ? { maxNewRequestsPerWeek: max, priority: codes.map((code) => ({ code, name: names[code] ?? code })) } : null;
  const lc = live && isObj(live.config) ? live.config : null;
  const sameRules = lc !== null && JSON.stringify(lc.rules) === JSON.stringify(dc.rules);
  return { draftId: draft.id, version: draft.version, liveVersion: live?.version ?? null, pacing, signable: pacing !== null && sameRules, failed: false };
}

/** Whether a screening rule set draft waits for the Chief Medical Officer's signature. Never throws; a failed read says so. */
export async function readPendingScreeningRuleSet(supabase: SupabaseClient<Database>): Promise<PendingScreeningRuleSet> {
  try {
    const loose = supabase as unknown as Loose;
    const sets = await loose.from("screening_rule_sets").select("id, version, is_active, approved_by, config");
    if (sets.error || !sets.data) return { ...NONE, failed: true };
    const rows = sets.data as Row[];
    const pending = pendingFromRows(rows, {});
    if (!pending.pacing) return pending;
    const types = await loose.from("screen_types").select("code, name").in("code", pending.pacing.priority.map((x) => x.code));
    const names: Record<string, string> = {};
    for (const t of (types.data ?? []) as { code: string; name: string }[]) names[t.code] = t.name;
    return pendingFromRows(rows, names);
  } catch {
    return { ...NONE, failed: true };
  }
}
