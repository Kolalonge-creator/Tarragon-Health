import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  readCompleteOutcome, readEnrolOutcome, readEntryQuestions, readStartOutcome,
  type AsyncStore, type CompleteOutcome, type EnrolOutcome, type EntryQuestions, type StartOutcome, type TherapyAnswers,
} from "@tarragon/shared";
import { supabase } from "@/lib/supabase";

/**
 * Programme calls for the phone (S63). Thin: the database decides everything (entry screen, per-session re-check, scores, worsening).
 * Every call answers with a closed result and never throws, so a screen can show a calm message. The device store holds the opened
 * session text and the queued completions only; a diary note is kept on this phone and no call here sends it.
 */
export const deviceStore: AsyncStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

export const diaryKey = (enrolmentId: string): string => `tarragon.therapy.diary.v1.${enrolmentId}`;

export interface ProgrammeRow { id: string; code: string; title: string; summary: string; guard_key: string }
export interface EnrolmentRow { id: string; programme_id: string; state: string; completed_count: number }

export async function loadOpenProgrammes(): Promise<{ programmes: ProgrammeRow[]; enrolments: EnrolmentRow[] } | null> {
  try {
    const [p, e] = await Promise.all([
      supabase.from("therapy_programmes").select("id, code, title, summary, guard_key").in("status", ["draft", "live"]).order("code"),
      supabase.from("therapy_enrolments").select("id, programme_id, state, completed_count").in("state", ["active", "paused", "completed"]),
    ]);
    if (p.error || e.error) return null;
    const open = await Promise.all((p.data ?? []).map(async (row) => {
      const { data } = await supabase.rpc("go_live_guard_is_open", { p_key: row.guard_key });
      return data === true ? row : null;
    }));
    return { programmes: open.filter((r): r is ProgrammeRow => r !== null), enrolments: e.data ?? [] };
  } catch {
    return null;
  }
}

export async function loadEntryQuestions(code: string): Promise<EntryQuestions | null> {
  try {
    const { data, error } = await supabase.rpc("get_therapy_entry_questions", { p_programme_code: code });
    return error ? null : readEntryQuestions(data);
  } catch {
    return null;
  }
}

export async function enrol(code: string, answers: TherapyAnswers): Promise<EnrolOutcome> {
  try {
    const { data, error } = await supabase.rpc("enrol_in_therapy_programme", { p_programme_code: code, p_answers: answers as unknown as Record<string, boolean | number> });
    return error ? { kind: "unknown" } : readEnrolOutcome(data);
  } catch {
    return { kind: "unknown" };
  }
}

export async function startSession(enrolmentId: string, ordinal: number, answers: TherapyAnswers): Promise<StartOutcome> {
  try {
    const { data, error } = await supabase.rpc("start_therapy_session", { p_enrolment: enrolmentId, p_ordinal: ordinal, p_recheck: answers as unknown as Record<string, boolean | number> });
    return error ? { kind: "unknown" } : readStartOutcome(data);
  } catch {
    return { kind: "unknown" };
  }
}

/** "network" means the call did not get an answer, so the caller may queue it; anything else is the database's answer. */
export async function completeSession(enrolmentId: string, ordinal: number, scores: Record<string, number> | null): Promise<CompleteOutcome | { kind: "network" }> {
  try {
    const { data, error } = await supabase.rpc("complete_therapy_session", { p_enrolment: enrolmentId, p_ordinal: ordinal, p_scores: scores ?? undefined });
    if (error) return /not started|not found|out of range|missing|unknown score|asked only/i.test(error.message) ? { kind: "not_active" } : { kind: "network" };
    return readCompleteOutcome(data);
  } catch {
    return { kind: "network" };
  }
}

export async function setSharing(enrolmentId: string, share: boolean): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("set_therapy_progress_sharing", { p_enrolment: enrolmentId, p_share: share });
    return !error;
  } catch {
    return false;
  }
}

export async function loadSharing(enrolmentId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from("therapy_share_consents").select("shared").eq("enrolment_id", enrolmentId).maybeSingle();
    return error ? null : (data?.shared ?? false);
  } catch {
    return null;
  }
}
