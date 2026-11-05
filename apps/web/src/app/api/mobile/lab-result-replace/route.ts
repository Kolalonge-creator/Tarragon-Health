import { prepareUpload } from "@/lib/uploads/prepare-upload";
import { safeErrorMessage } from "@/lib/http/safe-error";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { ABUSE_LIMIT_MESSAGE, checkAbuseLimit } from "@/lib/security/abuse-limits";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { runLabReportExtraction } from "@/lib/lab-reports/extraction-actions";
import { replaceResultDocumentSchema, validateResultDocFile } from "@/lib/validation/lab-result-documents";
import { verifyResultDocSignature } from "@/lib/validation/result-doc-signature";
import { screenUpload } from "@/lib/upload-scan/screen";
import { DUPLICATE_DOCUMENT_MESSAGE, isDuplicateDocumentError } from "@/lib/clinical-documents/duplicate";

/** SQLSTATEs public.replace_my_result_document raises before it writes anything. */
const REPLACE_REFUSAL_CODES: ReadonlySet<string> = new Set(["28000", "42501", "55000", "22023"]);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/**
 * Native mirror of replaceResultDocumentAsPatient
 * (apps/web/src/lib/lab-results/actions.ts) for the Expo mobile app, same
 * reasoning as lab-result-upload/route.ts: a Server Action can't be invoked
 * from a bare fetch. "I photographed the wrong result" — supersedes the
 * document (a new row linked to the old one, the old row and file kept) while
 * it's still unreviewed, through public.replace_my_result_document. The DB
 * function is the real gate; the checks below exist for a clear error message.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer (.+)$/)?.[1];
  if (!accessToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const supabase = createBearerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
  }
  // Security audit 2026-11-05 (M-8): bounded per user so a script cannot run up storage and AI costs.
  const limited = await checkAbuseLimit("upload", user.id);
  if (!limited.ok) {
    return NextResponse.json({ error: ABUSE_LIMIT_MESSAGE }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach the corrected file (PDF or photo)." }, { status: 400 });
  }
  const fileError = validateResultDocFile(file);
  if (fileError) {
    return NextResponse.json({ error: fileError }, { status: 400 });
  }
  const signatureError = await verifyResultDocSignature(file);
  if (signatureError) {
    return NextResponse.json({ error: signatureError }, { status: 400 });
  }
  // T2-08: scanned before it is stored. Infected: refused (422), never stored. Scanner down: stored, held as pending_scan.
  const screened = await screenUpload(createServiceRoleClient(), file, { patientId: user.id, uploadedBy: user.id });
  if (!screened.ok) {
    return NextResponse.json({ error: screened.error }, { status: 422 });
  }

  const parsed = replaceResultDocumentSchema.safeParse({
    document_id: formData.get("document_id"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { document_id: documentId, note } = parsed.data;

  const { data: doc } = await supabase
    .from("lab_result_documents")
    .select("id, patient_id, organisation_id, source, reviewed_at, file_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.patient_id !== user.id || doc.source !== "patient") {
    return NextResponse.json({ error: "That upload isn't yours to replace." }, { status: 403 });
  }
  if (doc.reviewed_at) {
    return NextResponse.json(
      { error: "Your care team has already reviewed this one — message them instead." },
      { status: 400 },
    );
  }

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${user.id}/${randomUUID()}.${ext}`;

  // Bytes must match the declared type, and photo location data is removed (security audit 2026-11-05, M-4/L-4).
  const prepared = await prepareUpload(file);
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });
  const { error: uploadError } = await supabase.storage
    .from(RESULT_DOC_BUCKET)
    .upload(path, prepared.upload.body, { contentType: prepared.upload.contentType, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: safeErrorMessage(uploadError, "mobile/lab-result-replace") }, { status: 500 });
  }

  // Supersede, never edit (see replaceResultDocumentAsPatient): the database function inserts the new document, links both ways,
  // keeps the old row and file, and hands the open review alert to the new document in one transaction.
  const { data: newDocumentId, error: replaceError } = await supabase.rpc("replace_my_result_document", {
    p_document_id: documentId,
    p_file_path: path,
    p_original_filename: file.name,
    p_mime_type: file.type,
    p_file_size_bytes: file.size,
    ...(note ? { p_note: note } : {}),
    p_content_sha256: screened.sha256,
  });
  if (isDuplicateDocumentError(replaceError)) {
    // The database refused before writing anything: this file is already in the record.
    await supabase.storage.from(RESULT_DOC_BUCKET).remove([path]);
    return NextResponse.json({ error: DUPLICATE_DOCUMENT_MESSAGE }, { status: 409 });
  }
  if (replaceError || !newDocumentId) {
    // Delete the new object only on a clear database refusal; after a timeout the replace may have committed (see
    // replaceResultDocumentAsPatient), and an orphaned object is the harmless side to err on.
    if (replaceError && REPLACE_REFUSAL_CODES.has(replaceError.code)) {
      await supabase.storage.from(RESULT_DOC_BUCKET).remove([path]);
    }
    return NextResponse.json({ error: safeErrorMessage(replaceError, "mobile/lab-result-replace", "Could not replace that upload.") }, { status: 500 });
  }

  await runLabReportExtraction(createServiceRoleClient(), {
    documentId: newDocumentId,
    organisationId: doc.organisation_id,
    patientId: user.id,
    filePath: path,
    mimeType: file.type,
  });

  return NextResponse.json({ success: true });
}
