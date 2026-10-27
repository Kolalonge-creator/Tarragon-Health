import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  classifyRpcError, isActivityRest, isMskProgrammeCode, readCompleteOutcome, readEnrolOutcome, readEntryQuestions, readFlareUpOutcome, readNotEnoughDays,
  readStartOutcome, validDifficulty,
  type AsyncStore, type CompleteOutcome, type EnrolOutcome, type EntryQuestions, type FlareUpOutcome, type StartOutcome, type TherapyAnswers,
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

/**
 * Pain programmes (S96) open through `start_msk_session`: it asks the activity safety gate first ("rest" opens nothing), then runs the same start,
 * so the entry screen is re-run every session. Every other programme uses the S63 start.
 */
export async function startSession(enrolmentId: string, ordinal: number, answers: TherapyAnswers, programmeCode?: string): Promise<StartOutcome | { kind: "rest" }> {
  try {
    const { data, error } = await supabase.rpc(isMskProgrammeCode(programmeCode) ? "start_msk_session" : "start_therapy_session", { p_enrolment: enrolmentId, p_ordinal: ordinal, p_recheck: answers as unknown as Record<string, boolean | number> });
    if (!error && isActivityRest(data)) return { kind: "rest" };
    return error ? { kind: "unknown" } : readStartOutcome(data);
  } catch {
    return { kind: "unknown" };
  }
}

/** "network" means the call did not get an answer, so the caller may queue it; "rejected" is a permanent answer to show, never queue. */
export async function completeSession(enrolmentId: string, ordinal: number, scores: Record<string, number> | null, programmeCode?: string): Promise<CompleteOutcome | { kind: "network" } | { kind: "rejected" } | { kind: "short"; daysNeeded: number }> {
  try {
    const { data, error } = await supabase.rpc(isMskProgrammeCode(programmeCode) ? "complete_msk_session" : "complete_therapy_session", { p_enrolment: enrolmentId, p_ordinal: ordinal, p_scores: scores ?? undefined });
    if (error) return classifyRpcError(error) === "permanent" ? { kind: "rejected" } : { kind: "network" };
    const short = readNotEnoughDays(data);
    if (short) return { kind: "short", daysNeeded: short.daysNeeded };
    return readCompleteOutcome(data);
  } catch {
    return { kind: "network" };
  }
}

export async function currentUserId(): Promise<string | undefined> {
  try {
    // the local session: no network round trip, so the id is there when the connection is not
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id;
  } catch {
    return undefined;
  }
}

export async function stopEnrolment(enrolmentId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("stop_therapy_enrolment", { p_enrolment: enrolmentId });
    return !error;
  } catch {
    return false;
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

/** A difficulty rating after a pain-programme exercise (S96). Never throws: `null` means it was not saved. */
export async function rateExercise(enrolmentId: string, ordinal: number, exerciseKey: string, rating: number): Promise<{ offerEasier: boolean; daysDone: number | null } | null> {
  if (!validDifficulty(rating)) return null;
  try {
    const { data, error } = await supabase.rpc("record_msk_exercise_rating", { p_enrolment: enrolmentId, p_ordinal: ordinal, p_exercise_key: exerciseKey, p_rating: rating });
    if (error || typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const o = data as Record<string, unknown>;
    if (o.status !== "ok") return null;
    return { offerEasier: o.offer_easier === true, daysDone: typeof o.days_done === "number" ? o.days_done : null };
  } catch {
    return null;
  }
}

/** "My pain got worse" (S96): the database re-runs the red-flag screen. An unreadable answer is "unknown", never a continue. */
export async function reportFlareUp(enrolmentId: string, answers: TherapyAnswers, painNow?: number): Promise<FlareUpOutcome> {
  try {
    const { data, error } = await supabase.rpc("report_msk_flare_up", { p_enrolment: enrolmentId, p_recheck: answers as unknown as Record<string, boolean | number>, p_pain_now: painNow });
    return error ? { kind: "unknown" } : readFlareUpOutcome(data);
  } catch {
    return { kind: "unknown" };
  }
}
