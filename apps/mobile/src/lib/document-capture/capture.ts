import { CONFIDENCE_LEVELS, DOCUMENT_CAPTURE_TYPES, decisionsForRpc, summariseDecisions, type DocumentCaptureType, type FieldDecision, type SuggestedField } from "@tarragon/shared";
import { supabase } from "../supabase";
import { postDocumentReading } from "../api";
import { isOffline, readThrough, type ReadResult } from "../passport-cache";

/**
 * Photo capture of a paper health document (S43, spec 2.3) on the phone: the ONLY module in the app that reads or writes `patient_documents`
 * (a repo scan test, document-capture-readers.test.ts, fails if any other file names the table).
 *
 * Rules kept here, each with a test:
 *  - A reading is only ever a SUGGESTION. Nothing here treats `extracted` as a value of the person's record; the screen shows it for confirming
 *    and the database keeps only what the person accepted. A rejected reading leaves the photo and nothing else.
 *  - Reading is requested only when the go-live guard `document_capture_enabled` is open (it is OFF). The phone checks the guard itself so it
 *    never even marks a photo as waiting for a reading when it is closed, and the server checks it again (the route never trusts the phone).
 *    If the guard cannot be read, it counts as closed: the photo is saved and no reading is asked for.
 *  - Suggestions and extracted text are NEVER kept in the offline copy. The saved list holds what kind of document it is, when it was added and
 *    where it is in the process, nothing read from it.
 *  - The upload and the row use one id per attempt, so a retry after a lost answer cannot make a second document.
 */
export const DOCUMENT_BUCKET = "patient-documents";
export const DOCUMENT_CAPTURE_GUARD = "document_capture_enabled";
export { DOCUMENT_CAPTURE_TYPES };
export type { DocumentCaptureType };

export type OcrState = "pending" | "suggested" | "confirmed" | "rejected" | "failed" | null;

export interface DocumentListItem {
  id: string;
  documentType: string;
  filename: string | null;
  createdAt: string;
  ocrState: OcrState;
  isPdf: boolean;
}

export const documentsCacheKey = (userId: string) => `documents:${userId}`;

const OCR_STATES = ["pending", "suggested", "confirmed", "rejected", "failed"] as const;

export function parseDocumentList(rows: unknown): DocumentListItem[] {
  if (!Array.isArray(rows)) return [];
  const out: DocumentListItem[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r.id !== "string" || typeof r.created_at !== "string" || typeof r.document_type !== "string") continue;
    out.push({
      id: r.id,
      documentType: r.document_type,
      filename: typeof r.original_filename === "string" ? r.original_filename : null,
      createdAt: r.created_at,
      ocrState: (OCR_STATES as readonly unknown[]).includes(r.ocr_state) ? (r.ocr_state as OcrState) : null,
      isPdf: r.mime_type === "application/pdf",
    });
  }
  return out;
}

/** The person's own documents, newest first. Only metadata is selected: never `extracted` or `ocr_text`. */
export function loadDocuments(userId: string): Promise<ReadResult<DocumentListItem[]>> {
  return readThrough(documentsCacheKey(userId), async () => {
    const { data, error } = await supabase
      .from("patient_documents")
      .select("id, document_type, original_filename, created_at, ocr_state, mime_type")
      .eq("patient_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return { ok: false, error };
    return { ok: true, data: parseDocumentList(data) };
  });
}

/** True only when the guard answers true. An error, a refusal or a missing answer is "closed". */
export async function isReadingOpen(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: DOCUMENT_CAPTURE_GUARD });
    return !error && data === true;
  } catch {
    return false;
  }
}

export interface SaveDocumentInput {
  userId: string;
  organisationId: string;
  /** One id per document the person is adding. Kept across retries so the upload and the row are never made twice. */
  attemptId: string;
  type: DocumentCaptureType;
  bytes: Uint8Array;
  mime: "image/jpeg" | "application/pdf";
  filename: string;
}

export type ReadingOutcome = "not_asked" | "asked" | "closed" | "failed";

export type SaveDocumentResult =
  | { ok: true; documentId: string; reading: ReadingOutcome }
  | { ok: false; reason: "offline" | "failed" | "bad_type" };

const DUPLICATE = "23505";

export async function saveDocument(input: SaveDocumentInput): Promise<SaveDocumentResult> {
  if (!(DOCUMENT_CAPTURE_TYPES as readonly string[]).includes(input.type)) return { ok: false, reason: "bad_type" };
  const open = await isReadingOpen();
  const ext = input.mime === "application/pdf" ? "pdf" : "jpg";
  const path = `${input.userId}/${input.attemptId}.${ext}`;

  const upload = await supabase.storage.from(DOCUMENT_BUCKET).upload(path, input.bytes, { contentType: input.mime, upsert: false });
  if (upload.error) {
    const detail = upload.error as { message?: string; statusCode?: string | number };
    const exists = /already exists|duplicate/i.test(detail.message ?? "") || String(detail.statusCode) === "409";
    if (!exists) return { ok: false, reason: isOffline({ message: detail.message }) ? "offline" : "failed" };
  }

  const { error } = await supabase.from("patient_documents").insert({
    id: input.attemptId,
    organisation_id: input.organisationId,
    patient_id: input.userId,
    document_type: input.type,
    file_path: path,
    original_filename: input.filename.slice(0, 200),
    mime_type: input.mime,
    file_size_bytes: input.bytes.length,
    source: "patient",
    // Only asked to be read when reading is open; otherwise the photo is a plain upload and no reading is ever waiting.
    ocr_state: open ? "pending" : null,
  });
  if (error && error.code !== DUPLICATE) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };

  if (!open) return { ok: true, documentId: input.attemptId, reading: "closed" };
  // The photo is saved whatever happens next: a reading that cannot be asked for is reported, never a lost photo.
  const asked = await postDocumentReading(input.attemptId);
  return { ok: true, documentId: input.attemptId, reading: asked.ok && asked.status !== "failed" ? "asked" : "failed" };
}

export async function requestReading(documentId: string): Promise<{ ok: true; status: string } | { ok: false; offline: boolean }> {
  const r = await postDocumentReading(documentId);
  return r.ok ? { ok: true, status: r.status } : { ok: false, offline: r.offline };
}

export interface DocumentDetail {
  fields: SuggestedField[];
  photoUrl: string | null;
  isPdf: boolean;
}

/** Keeps only well-formed suggestions, the way the database normalises them. Anything else is dropped, never repaired. */
export function parseSuggestedFields(extracted: unknown): SuggestedField[] {
  const raw = (extracted as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(raw)) return [];
  const out: SuggestedField[] = [];
  for (const f of raw as Record<string, unknown>[]) {
    if (!f || typeof f.key !== "string" || typeof f.label !== "string" || typeof f.value !== "string" || f.key === "") continue;
    const confidence = (CONFIDENCE_LEVELS as readonly unknown[]).includes(f.confidence) ? (f.confidence as SuggestedField["confidence"]) : "low";
    out.push({ key: f.key, label: f.label, value: f.value, unit: typeof f.unit === "string" && f.unit !== "" ? f.unit : null, confidence });
  }
  return out;
}

/**
 * Read live, on opening one document: its suggestions (or the details the person confirmed) and a short-lived link to the photo. Never cached.
 * Returns null on any failure, so the screen says it could not load rather than showing a document with nothing on it.
 */
export async function loadDocumentDetail(documentId: string): Promise<DocumentDetail | null> {
  try {
    const { data, error } = await supabase.from("patient_documents").select("extracted, file_path, mime_type").eq("id", documentId).maybeSingle();
    if (error || !data) return null;
    const isPdf = data.mime_type === "application/pdf";
    const signed = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(data.file_path, 600);
    return { fields: parseSuggestedFields(data.extracted), photoUrl: signed.data?.signedUrl ?? null, isPdf };
  } catch {
    return null;
  }
}

export type ConfirmResult = { ok: true; kept: number } | { ok: false; reason: "none_accepted" | "offline" | "not_waiting" | "failed" };

/** Sends only what the person decided. At least one accepted field is required; the database drops everything not accepted. */
export async function confirmFields(documentId: string, fields: readonly SuggestedField[], decisions: readonly FieldDecision[]): Promise<ConfirmResult> {
  const summary = summariseDecisions(fields, decisions);
  if (!summary.canConfirm) return { ok: false, reason: "none_accepted" };
  const { data, error } = await supabase.rpc("confirm_document_extraction", { p_document: documentId, p_fields: decisionsForRpc(fields, decisions).map((d) => ({ key: d.key, accept: d.accept, ...(d.value !== undefined ? { value: d.value } : {}) })) });
  if (error) {
    if (isOffline(error)) return { ok: false, reason: "offline" };
    if (/nothing waiting/i.test(error.message)) return { ok: false, reason: "not_waiting" };
    if (/confirm at least one/i.test(error.message)) return { ok: false, reason: "none_accepted" };
    return { ok: false, reason: "failed" };
  }
  return { ok: true, kept: (data as { kept?: number } | null)?.kept ?? 0 };
}

/** The person rejects the whole reading. The photo stays; the text and every value go (the database function does this). */
export async function rejectReading(documentId: string): Promise<{ ok: true } | { ok: false; reason: "offline" | "failed" }> {
  const { error } = await supabase.rpc("reject_document_extraction", { p_document: documentId });
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  return { ok: true };
}
