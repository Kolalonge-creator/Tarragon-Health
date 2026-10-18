import { supabase } from "./supabase";
import type { QueryResult } from "./medications";
import type { Tables } from "@tarragon/shared";
import { API_BASE_URL } from "./api";

// ---------------------------------------------------------------------------
// Second opinion — pay-per-service, no plan bypass. Mirrors apps/web/src/app/
// (dashboard)/patient/second-opinion-request.tsx. A plain insert, not a
// two-step RPC: the credit gate lives in a BEFORE INSERT trigger on
// second_opinion_requests (20260831165614_second_opinion_requests.sql),
// which raises a specific, catchable error when no credit exists — this file
// never pre-checks for a credit client-side, same reasoning as
// care-support.ts's ASK_A_DOCTOR_CREDIT_REQUIRED_MARKER.
// ---------------------------------------------------------------------------

export type SecondOpinionRequest = Tables<"second_opinion_requests">;
export type SecondOpinionRequestWithAnswerer = SecondOpinionRequest & {
  answerer: { full_name: string } | null;
};

type SecondOpinionAnswerer = NonNullable<SecondOpinionRequestWithAnswerer["answerer"]>;

/**
 * `answered_by` used to be embedded directly via
 * `clinical_staff!second_opinion_requests_answered_by_fkey(...)` — a
 * PostgREST embedded join, which resolves against `clinical_staff`'s OWN
 * RLS, not this query's own. Since 2026-09-25 (see
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql)
 * that policy no longer admits a patient session, so the embed would
 * silently come back null for every patient viewing their own answered
 * request. Fetching the answerer separately from
 * public.clinical_staff_directory (the safe-column view every
 * patient-facing clinical_staff read now uses) restores the same
 * attribution without reopening the column-exposure gap that migration
 * fixed. Mirrors apps/web/src/lib/queries/second-opinion.ts's
 * fetchAnswerers.
 */
async function fetchAnswerers(answererIds: string[]): Promise<Map<string, SecondOpinionAnswerer>> {
  const answererById = new Map<string, SecondOpinionAnswerer>();
  if (answererIds.length === 0) return answererById;
  const { data, error } = await supabase.from("clinical_staff_directory").select("id, full_name").in("id", answererIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.id) continue;
    answererById.set(row.id, { full_name: row.full_name ?? "" });
  }
  return answererById;
}

/** Matches the trigger's raised text exactly: 'Buy a second opinion credit
 * to send this request.' (second_opinion_requests_enforce_credit). */
export const SECOND_OPINION_CREDIT_REQUIRED_MARKER = "second opinion credit";

/**
 * The Members-only second opinion price in kobo, read from the product row (never typed into the app). Shown in this signed-in app only;
 * a Free person is told it is part of Membership and sees no price.
 */
export async function loadSecondOpinionPriceKobo(): Promise<number | null> {
  const { data, error } = await supabase.from("service_products").select("price_kobo").eq("code", "second_opinion_credit").maybeSingle();
  if (error || !data || typeof data.price_kobo !== "number") return null;
  return data.price_kobo;
}

export async function loadMySecondOpinionRequests(
  patientId: string
): Promise<QueryResult<SecondOpinionRequestWithAnswerer[]>> {
  try {
    const { data, error } = await supabase
      .from("second_opinion_requests")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return { ok: false, error: error.message };

    const rows = data ?? [];
    const answererIds = Array.from(new Set(rows.map((row) => row.answered_by).filter((id): id is string => !!id)));
    const answererById = await fetchAnswerers(answererIds);

    return {
      ok: true,
      data: rows.map((row) => ({
        ...row,
        answerer: row.answered_by ? (answererById.get(row.answered_by) ?? null) : null,
      })) as SecondOpinionRequestWithAnswerer[],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Results and photos shared with the doctor, and the referral a doctor may
// recommend. Mirrors apps/web/src/lib/queries/second-opinion.ts: the database
// re-checks every id (public.share_results_with_second_opinion), a doctor
// opens the shared material only through an audited read, and a recommended
// referral is a draft until the patient accepts it.
// ---------------------------------------------------------------------------

export type ShareableResult = { id: string; panelCode: string | null; receivedAt: string; valueCount: number };

/** Released, current results that carry values: the only ones the database accepts for sharing. */
export async function loadShareableResults(): Promise<QueryResult<ShareableResult[]>> {
  const { data, error } = await supabase.rpc("my_lab_results");
  if (error) return { ok: false, error: error.message };
  const rows = Array.isArray(data) ? (data as unknown[]) : [];
  const out: ShareableResult[] = [];
  for (const row of rows) {
    const r = row as { lab_result_id?: unknown; panel_code?: unknown; received_at?: unknown; status?: unknown; replaced?: unknown; items?: unknown };
    if (typeof r.lab_result_id !== "string" || typeof r.received_at !== "string") continue;
    if (r.status !== "released" || r.replaced === true) continue;
    const count = Array.isArray(r.items) ? r.items.length : 0;
    if (count === 0) continue;
    out.push({ id: r.lab_result_id, panelCode: typeof r.panel_code === "string" ? r.panel_code : null, receivedAt: r.received_at, valueCount: count });
  }
  return { ok: true, data: out };
}

export const SECOND_OPINION_MAX_SHARED_RESULTS = 10;
export const SECOND_OPINION_MAX_PHOTOS = 5;
const SECOND_OPINION_PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const SECOND_OPINION_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

export type SubmitWithMaterialResult = QueryResult<{ resultsAttached: boolean; photosFailed: number }>;

/**
 * Sends the request, then attaches the chosen results and photos. Attaching never fails the send: the request (and its redeemed credit)
 * already exist, and a failed send would invite a second tap and a second credit.
 */
export async function submitSecondOpinionWithMaterial(input: {
  patientId: string;
  organisationId: string;
  existingDiagnosisOrResult: string;
  sourceDescription?: string;
  specificQuestion?: string;
  sharedLabResultIds: string[];
  photos: { uri: string; mimeType: string }[];
}): Promise<SubmitWithMaterialResult> {
  const { data: created, error } = await supabase
    .from("second_opinion_requests")
    .insert({
      patient_id: input.patientId,
      organisation_id: input.organisationId,
      existing_diagnosis_or_result: input.existingDiagnosisOrResult,
      source_description: input.sourceDescription || null,
      specific_question: input.specificQuestion || null,
    })
    .select("id")
    .single();
  if (error || !created) return { ok: false, error: error?.message ?? "Could not send this request." };

  let resultsAttached = true;
  if (input.sharedLabResultIds.length > 0) {
    const { error: shareError } = await supabase.rpc("share_results_with_second_opinion", {
      p_request: created.id,
      p_lab_results: input.sharedLabResultIds,
    });
    if (shareError) resultsAttached = false;
  }

  let photosFailed = 0;
  for (const photo of input.photos) {
    const ext = SECOND_OPINION_PHOTO_EXT[photo.mimeType];
    if (!ext) {
      photosFailed += 1;
      continue;
    }
    try {
      const bytes = await (await fetch(photo.uri)).arrayBuffer();
      if (bytes.byteLength === 0 || bytes.byteLength > SECOND_OPINION_PHOTO_MAX_BYTES) {
        photosFailed += 1;
        continue;
      }
      const path = `${input.patientId}/${created.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("second-opinion-documents")
        .upload(path, bytes, { contentType: photo.mimeType, upsert: false });
      if (uploadError) {
        photosFailed += 1;
        continue;
      }
      const { error: attachError } = await supabase.rpc("attach_second_opinion_document", {
        p_request: created.id,
        p_path: path,
        p_mime: photo.mimeType,
        p_bytes: bytes.byteLength,
      });
      if (attachError) photosFailed += 1;
    } catch {
      photosFailed += 1;
    }
  }
  return { ok: true, data: { resultsAttached, photosFailed } };
}

export type RecommendedReferral = { id: string; status: string; specialistType: string; reason: string | null };

export async function loadRecommendedReferral(referralId: string): Promise<QueryResult<RecommendedReferral | null>> {
  const { data, error } = await supabase
    .from("specialist_referrals")
    .select("id, status, specialist_type, referral_reason")
    .eq("id", referralId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, data: null };
  return { ok: true, data: { id: data.id, status: data.status, specialistType: data.specialist_type, reason: data.referral_reason } };
}

export async function acceptSecondOpinionReferral(requestId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("accept_second_opinion_referral", { p_request: requestId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/**
 * The referral letter, opened in the system browser (Safari's own viewer handles print/share/save), with the caller's short-lived
 * access token as a query param like the verified-document PDF. Needs the bearer variant of the letter route (added with this change).
 */
export async function getReferralLetterUrl(referralId: string): Promise<QueryResult<string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "Not signed in" };
  return { ok: true, data: `${API_BASE_URL}/api/mobile/referral/${referralId}/letter?token=${encodeURIComponent(session.access_token)}` };
}
