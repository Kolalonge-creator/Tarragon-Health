import type { BpAckLevel, DiaryDraftRow, SaveAnswer } from "@tarragon/shared";
import { API_BASE_URL, fetchWithTimeoutAndRetry } from "./api";
import { supabase } from "./supabase";

/**
 * The phone's two calls for the paper diary (S07y): the same doors the web uses, behind the same go-live guards.
 *
 * Online only, never queued: a diary row is dated inside a bounded window and the server keeps it only if it is inside that window when it ARRIVES, so a row
 * left in an offline queue could be refused days later with nobody looking. Every row carries its own id, so the one quick retry the fetch helper makes (and a
 * second press of Save) can never double a reading.
 */

/** What POST /api/mobile/diary/save answers when the save ran (apps/web/src/lib/diary/handlers.ts). */
export interface DiarySaveAnswer extends SaveAnswer {
  bpAckLevel?: BpAckLevel;
  safetyAssessmentFailed: boolean;
}

export type PostDiarySaveResult =
  | { ok: true; answer: DiarySaveAnswer }
  | { ok: false; offline: boolean; /** the server says this feature is not switched on for the person */ closed: boolean; /** the caller may not log for that person */ denied: boolean };

async function token(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** Sends the rows the person CONFIRMED. */
export async function postDiarySave(rows: readonly DiaryDraftRow[], beneficiaryProfileId?: string): Promise<PostDiarySaveResult> {
  const accessToken = await token();
  if (!accessToken) return { ok: false, offline: false, closed: false, denied: false };
  try {
    const response = await fetchWithTimeoutAndRetry(`${API_BASE_URL}/api/mobile/diary/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ rows: rows.map((r) => ({ ...r, confirmed: true })), ...(beneficiaryProfileId ? { beneficiary_profile_id: beneficiaryProfileId } : {}) }),
    });
    const json = (await response.json().catch(() => null)) as (Omit<DiarySaveAnswer, "status"> & { status?: string; error?: string }) | null;
    // Two different 403s: the feature is not switched on ({ status: "not_open" }), or the caller has no live grant for the person they are logging for (an error).
    if (response.status === 403) return { ok: false, offline: false, closed: json?.status === "not_open", denied: json?.status !== "not_open" };
    if (!response.ok || !json || json.status !== "done" || !Array.isArray(json.results)) return { ok: false, offline: false, closed: false, denied: false };
    return { ok: true, answer: json as DiarySaveAnswer };
  } catch {
    return { ok: false, offline: true, closed: false, denied: false };
  }
}

export type DiaryReadAnswer =
  | { status: "suggested"; rows: DiaryDraftRow[]; skipped: number }
  | { status: "unreadable" }
  | { status: "unavailable" }
  | { status: "not_open" }
  | { status: "rate_limited" }
  | { status: "bad_file"; reason: "too_big" | "not_image" | "missing" };

export type PostDiaryReadResult = { ok: true; answer: DiaryReadAnswer } | { ok: false; offline: boolean };

/** A photo of a diary page to SUGGESTED rows (AI-021). The server stores nothing: not the photo, not a value. */
export async function postDiaryRead(photo: { uri: string; mimeType: string; fileName: string }): Promise<PostDiaryReadResult> {
  const accessToken = await token();
  if (!accessToken) return { ok: false, offline: false };
  const formData = new FormData();
  // React Native's FormData accepts { uri, type, name } for a local file; the DOM typings do not know that shape.
  formData.append("file", { uri: photo.uri, type: photo.mimeType, name: photo.fileName } as unknown as Blob);
  try {
    const response = await fetchWithTimeoutAndRetry(`${API_BASE_URL}/api/mobile/diary/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });
    const json = (await response.json().catch(() => null)) as DiaryReadAnswer | null;
    if (!json || typeof json.status !== "string") return { ok: false, offline: false };
    return { ok: true, answer: json };
  } catch {
    // a thrown fetch is a network failure
    return { ok: false, offline: true };
  }
}
