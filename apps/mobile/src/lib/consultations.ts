import { supabase } from "./supabase";
import { postConsultationDialIn, postConsultationJoin } from "./api";
import { parseRoomView, parseUpcoming, type RoomView, type UpcomingConsultation } from "./consultation-room-model";

/**
 * S21 follow-up (OQ-158): the patient's consultation room on the phone, over the SAME database functions the web room uses.
 * Reading the list and the room, the scribe consent answer and "nobody came" go straight to the database as the signed-in patient
 * (the functions check auth.uid(), INV-12); joining and dialling in go through the two bearer routes, because they need the video
 * vendor's credentials, which never live in this app. No vendor logic is duplicated here.
 *
 * A join link, a dial-in number or a passcode is never stored, logged or written to the diagnostics ring from this module.
 *
 * The generated database types do not carry the S21 functions (the same reason the web screens cast), so the client is cast to an
 * rpc-only shape. NOT run on a real phone: no EAS dev-client build exists for this app yet.
 */
type RpcResult = { data: unknown; error: { message: string } | null };
type RpcOnly = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };
const db = (): RpcOnly => supabase as unknown as RpcOnly;

export type LoadResult<T> = { ok: true; data: T } | { ok: false };

export async function loadUpcomingConsultations(): Promise<LoadResult<UpcomingConsultation[]>> {
  try {
    const { data, error } = await db().rpc("my_upcoming_encounters", { p_limit: 20 });
    const rows = error ? null : parseUpcoming(data);
    return rows ? { ok: true, data: rows } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Null data is "no such consultation for you" (the function answers the same for a stranger and an unknown id). */
export async function loadRoomView(encounterId: string): Promise<LoadResult<RoomView | null>> {
  try {
    const { data, error } = await db().rpc("consultation_room_view", { p_encounter: encounterId });
    if (error) return { ok: false };
    if (data === null) return { ok: true, data: null };
    const view = parseRoomView(data);
    // This screen is the patient's. A clinician's room stays on the web.
    if (!view) return { ok: false };
    return { ok: true, data: view.role === "patient" ? view : null };
  } catch {
    return { ok: false };
  }
}

/**
 * CON-001: the patient's own answer for this one consultation (INV-11). Asked, then recorded; returns true only when BOTH calls
 * succeeded, so a failed save can never look like a saved answer.
 */
export async function answerScribeConsent(encounterId: string, granted: boolean): Promise<boolean> {
  try {
    const asked = await db().rpc("open_scribe_prompt", { p_encounter: encounterId });
    if (asked.error) return false;
    const saved = await db().rpc("record_scribe_consent", { p_encounter: encounterId, p_granted: granted });
    return !saved.error;
  } catch {
    return false;
  }
}

export type NoShowResult = "ok" | "wait_longer" | "failed";

/** "Tell us nobody came". The database applies the wait rule from its own clock and policy; the app never decides it. */
export async function reportNobodyCame(encounterId: string): Promise<NoShowResult> {
  try {
    const { error } = await db().rpc("mark_encounter_no_show", { p_encounter: encounterId });
    if (!error) return "ok";
    return /wait a little longer/.test(error.message) ? "wait_longer" : "failed";
  } catch {
    return "failed";
  }
}

export const requestJoin = postConsultationJoin;
export const requestDialIn = postConsultationDialIn;
