import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { MSK_PROGRAMME_CODES, type MskProgrammeCode } from "@tarragon/shared";

/** The line the back, neck, knee and hip pain programmes carry on the Chief Medical Officer's sign-off hub (S96). */
export const MSK_PROGRAMMES_ITEM_KEY = "msk_programmes";

export type MskExerciseView = { key: string; name: string; intensity: string; dose: string; steps: string[]; easier: string; harder: string; stopIf: string };
export type MskSessionView = { ordinal: number; title: string; body: string; exercises: MskExerciseView[] };
export type MskQuestionView = { code: string; question: string; route: string; unverified: boolean };
export type MskProgrammeView = {
  code: MskProgrammeCode;
  title: string;
  /** The programme's current content version and its review state ('draft' until the CMO approves it). */
  version: number;
  reviewState: string;
  sessions: MskSessionView[];
  /** The newest entry-list version and whether the CMO has confirmed it. */
  listVersion: number | null;
  listStatus: string | null;
  questions: MskQuestionView[];
};

export type PendingMskProgrammesSignoff = {
  programmes: MskProgrammeView[];
  /** Programmes with content not approved or an entry list not confirmed. */
  waitingCount: number;
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

const EMPTY: PendingMskProgrammesSignoff = { programmes: [], waitingCount: 0, failed: false };

type Ex = { key?: unknown; name?: unknown; intensity?: unknown; dose?: unknown; steps?: unknown; easier?: unknown; harder?: unknown; stop_if?: unknown };

function toExercises(raw: unknown): MskExerciseView[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Ex[]).map((e) => ({
    key: String(e.key ?? ""),
    name: String(e.name ?? ""),
    intensity: String(e.intensity ?? ""),
    dose: String(e.dose ?? ""),
    steps: Array.isArray(e.steps) ? e.steps.map(String) : [],
    easier: String(e.easier ?? ""),
    harder: String(e.harder ?? ""),
    stopIf: String(e.stop_if ?? ""),
  }));
}

/** Pure: a programme waits when its content is not approved or its newest entry list is not confirmed. */
export function mskProgrammeWaits(p: Pick<MskProgrammeView, "reviewState" | "listStatus">): boolean {
  return p.reviewState !== "approved" || p.listStatus !== "confirmed";
}

/**
 * What the four pain programmes need from the Chief Medical Officer, for the sign-off hub: the draft content (read in full on the hub) and
 * the draft entry list. Never throws; a failed read says so. The attestations (clinician cover, outcome thresholds) are on the go-live page.
 */
export async function readPendingMskProgrammesSignoff(supabase: SupabaseClient<Database>): Promise<PendingMskProgrammesSignoff> {
  try {
    const codes = [...MSK_PROGRAMME_CODES];
    const progs = await supabase.from("therapy_programmes").select("id, code, title, current_version").in("code", codes);
    if (progs.error || !progs.data) return { ...EMPTY, failed: true };
    const out: MskProgrammeView[] = [];
    for (const code of codes) {
      const p = progs.data.find((x) => x.code === code);
      if (!p) return { ...EMPTY, failed: true };
      const [ver, sess, lists] = await Promise.all([
        supabase.from("therapy_programme_versions").select("review_state").eq("programme_id", p.id).eq("version", p.current_version).maybeSingle(),
        supabase.from("therapy_programme_sessions").select("ordinal, title, text_body, exercises").eq("programme_id", p.id).eq("version", p.current_version).order("ordinal"),
        supabase.from("therapy_exclusion_list_versions").select("version, status").eq("programme_code", code).order("version", { ascending: false }).limit(1),
      ]);
      if (ver.error || sess.error || lists.error) return { ...EMPTY, failed: true };
      const newest = lists.data?.[0] ?? null;
      let questions: MskQuestionView[] = [];
      if (newest) {
        const rules = await supabase.from("therapy_exclusion_rules").select("item_code, question, route, unverified, ordinal").eq("programme_code", code).eq("list_version", newest.version).order("ordinal");
        if (rules.error) return { ...EMPTY, failed: true };
        questions = (rules.data ?? []).map((r) => ({ code: r.item_code, question: r.question, route: r.route, unverified: r.unverified }));
      }
      out.push({
        code,
        title: p.title,
        version: p.current_version,
        reviewState: ver.data?.review_state ?? "draft",
        sessions: (sess.data ?? []).map((s) => ({ ordinal: s.ordinal, title: s.title, body: s.text_body, exercises: toExercises(s.exercises) })),
        listVersion: newest?.version ?? null,
        listStatus: newest?.status ?? null,
        questions,
      });
    }
    return { programmes: out, waitingCount: out.filter(mskProgrammeWaits).length, failed: false };
  } catch {
    return { ...EMPTY, failed: true };
  }
}
