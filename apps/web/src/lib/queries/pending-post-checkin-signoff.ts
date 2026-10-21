import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

/** What the sign-off panel shows, read from the draft itself so the words the CMO signs are the values that will apply. */
export type PostCheckinRulesView = {
  offsets: { code: string; afterHours: number }[];
  nudgeAfterHours: number;
  expireAfterHours: number;
  maxNudges: number;
  concernAlertLevel: string;
  questions: { text: string; options: { label: string; route: string }[] }[];
};

export type PendingPostCheckinSignoff = {
  /** An unsigned, inactive post_consult_checkin_config version newer than the one in force. */
  version: number | null;
  rules: PostCheckinRulesView | null;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { version: number; is_active: boolean; approved_at: string | null; rules?: unknown };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

const FAILED: PendingPostCheckinSignoff = { version: null, rules: null, failed: true };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pure: the panel view from a draft's rules, or null when something it must show is missing (the panel then says nothing rather than guess). */
export function postCheckinRulesView(rules: unknown): PostCheckinRulesView | null {
  if (!isObj(rules)) return null;
  const { offsets, questions, nudge_after_minutes: nudge, expire_after_minutes: expire, max_nudges: maxNudges, concern_alert_level: level } = rules;
  if (!Array.isArray(offsets) || !Array.isArray(questions) || typeof nudge !== "number" || typeof expire !== "number" || typeof maxNudges !== "number" || typeof level !== "string") return null;
  const offs: PostCheckinRulesView["offsets"] = [];
  for (const o of offsets) {
    if (!isObj(o) || typeof o.code !== "string" || typeof o.after_minutes !== "number") return null;
    offs.push({ code: o.code, afterHours: Math.round(o.after_minutes / 60) });
  }
  const qs: PostCheckinRulesView["questions"] = [];
  for (const q of questions) {
    if (!isObj(q) || typeof q.text !== "string" || !Array.isArray(q.options)) return null;
    const options: { label: string; route: string }[] = [];
    for (const op of q.options) {
      if (!isObj(op) || typeof op.label !== "string" || typeof op.route !== "string") return null;
      options.push({ label: op.label, route: op.route });
    }
    qs.push({ text: q.text, options });
  }
  return { offsets: offs, nudgeAfterHours: Math.round(nudge / 60), expireAfterHours: Math.round(expire / 60), maxNudges, concernAlertLevel: level, questions: qs };
}

/**
 * What the post-consultation check-in configuration needs from the Chief Medical Officer, for the sign-off hub. Nothing signs by itself: the draft
 * stays inactive until the CMO presses the sign control. Never throws; a failed read says so.
 */
export async function readPendingPostCheckinSignoff(supabase: SupabaseClient<Database>): Promise<PendingPostCheckinSignoff> {
  try {
    const res = await (supabase as unknown as Loose).from("post_consult_checkin_config").select("version, is_active, approved_at, rules");
    if (res.error || !res.data) return FAILED;
    const version = newestWaiting(res.data);
    return { version, rules: version === null ? null : postCheckinRulesView(res.data.find((r) => r.version === version)?.rules), failed: false };
  } catch {
    return FAILED;
  }
}
