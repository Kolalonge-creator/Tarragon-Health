import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diaryLimits, type Database, type DiaryDraftRow, type DiaryLimits } from "@tarragon/shared";
import { rateLimit } from "@/lib/rate-limit";
import { DIARY_AI_GUARD, DIARY_ENTRY_GUARD, isGuardOpen } from "./guards";
import { readDiaryPage, type ReadDiaryOutcome } from "./read-diary-page";
import { diarySaveRequestSchema, saveDiaryReadings, type DiarySaveResult } from "./save-diary-readings";

/**
 * The two doors of the paper diary, written once for the web (cookie session) and the phone (bearer token), so they cannot drift apart.
 *
 *  - read: a photo of a diary page to SUGGESTED rows. Stores nothing. Closed unless the paper_diary_ai_reader guard is open for the person.
 *  - save: the rows the person CONFIRMED to readings, through the ordinary reading path. Closed unless the paper_diary_entry guard is open.
 */

export type DiaryReadResponse =
  | { status: "not_open" }
  | { status: "rate_limited" }
  | { status: "bad_file"; reason: "too_big" | "not_image" | "missing" }
  | ReadDiaryOutcome;

export async function handleDiaryRead(
  supabase: SupabaseClient<Database>,
  userId: string,
  file: File | null
): Promise<{ httpStatus: number; body: DiaryReadResponse }> {
  // The cheap checks come first (no round trip, no bytes loaded). The size is known before a byte is read: an oversize upload is refused without loading it.
  if (!file || file.size === 0) return { httpStatus: 400, body: { status: "bad_file", reason: "missing" } };
  if (file.size > diaryLimits().maxPhotoBytes) return { httpStatus: 400, body: { status: "bad_file", reason: "too_big" } };
  // Both switches must be open: a photo of a health diary is sent to a paid model, and the suggestions are useless to a person who cannot then save them.
  const [readerOpen, entryOpen] = await Promise.all([isGuardOpen(supabase, DIARY_AI_GUARD), isGuardOpen(supabase, DIARY_ENTRY_GUARD)]);
  if (!readerOpen || !entryOpen) return { httpStatus: 200, body: { status: "not_open" } };
  // Each read is a paid model call: a per-person ceiling, through the same limiter the sign-in and verification doors use (Upstash when it is provisioned, an
  // in-process window otherwise). The model system's own switch and the guard are the controls that matter most; this stops a loop from running up the bill.
  const limits = diaryLimits();
  const limited = await rateLimit(`diary-read:user:${userId}`, { limit: limits.maxReadsPerHour, windowSeconds: 3600 });
  if (!limited.success) return { httpStatus: 429, body: { status: "rate_limited" } };
  const bytes = Buffer.from(await file.arrayBuffer());
  const outcome = await readDiaryPage(supabase, { patientId: userId, bytes, mediaType: file.type });
  return { httpStatus: outcome.status === "bad_file" ? 400 : 200, body: outcome };
}

/** The window the database itself will apply (offline_sync_config), so the check here and the insert trigger cannot disagree; the registry value if it cannot be read. */
async function databaseLimits(supabase: SupabaseClient<Database>): Promise<DiaryLimits> {
  const configured = diaryLimits();
  try {
    const { data } = await supabase.from("offline_sync_config").select("diary_window_days, future_skew_minutes").eq("is_active", true).maybeSingle();
    if (!data) return configured;
    return { ...configured, windowDays: data.diary_window_days, skewMinutes: data.future_skew_minutes };
  } catch {
    return configured;
  }
}

export type DiarySaveResponse =
  | { status: "not_open" }
  | { status: "invalid"; message: string }
  | ({ status: "done" } & DiarySaveResult);

export async function handleDiarySave(
  supabase: SupabaseClient<Database>,
  /** userId is the signed-in person; subjectId is whose readings these are (the same person, or someone they support). */
  who: { userId: string; subjectId: string; route: string },
  body: unknown
): Promise<{ httpStatus: number; body: DiarySaveResponse }> {
  const parsed = diarySaveRequestSchema.safeParse(body);
  if (!parsed.success) return { httpStatus: 400, body: { status: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" } };
  // The guard is judged for the person the readings belong to. For the signed-in person's own account that is checked here for a friendly answer; for
  // someone they support the database trigger is the only judge (go_live_guard_is_open answers for the CALLER, which can differ for a test account),
  // and a refusal comes back per row as "closed".
  if (who.subjectId === who.userId && !(await isGuardOpen(supabase, DIARY_ENTRY_GUARD))) return { httpStatus: 403, body: { status: "not_open" } };

  const { data: profile } = await supabase.from("profiles").select("organisation_id").eq("id", who.subjectId).single();
  if (!profile?.organisation_id) return { httpStatus: 400, body: { status: "invalid", message: "No organisation on file" } };

  const rows: DiaryDraftRow[] = parsed.data.rows;
  const result = await saveDiaryReadings(supabase, { subjectId: who.subjectId, organisationId: profile.organisation_id, route: who.route }, rows, { limits: await databaseLimits(supabase) });
  return { httpStatus: 200, body: { status: "done", ...result } };
}
