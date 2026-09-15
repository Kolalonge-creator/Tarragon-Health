import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { runLabReportExtraction } from "@/lib/lab-reports/extraction-actions";
import { replaceResultDocumentSchema, validateResultDocFile } from "@/lib/validation/lab-result-documents";

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
 * from a bare fetch. "I photographed the wrong result" — swaps the file on
 * the same lab_result_documents row, in place, while it's still unreviewed.
 * DB-enforced (20260912220345_lab_result_documents_patient_self_replace.sql)
 * via the bearer-authenticated client's own RLS session; the checks below
 * exist for a clear error message, not as the real gate.
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

  const oldPath = doc.file_path;
  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(RESULT_DOC_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("lab_result_documents")
    .update({
      file_path: path,
      original_filename: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
      ...(note ? { note } : {}),
      ai_summary_status: "pending",
      ai_summary_generated_at: null,
    })
    .eq("id", documentId);
  if (updateError) {
    await supabase.storage.from(RESULT_DOC_BUCKET).remove([path]);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await supabase.storage.from(RESULT_DOC_BUCKET).remove([oldPath]);

  await runLabReportExtraction(createServiceRoleClient(), {
    documentId,
    organisationId: doc.organisation_id,
    patientId: user.id,
    filePath: path,
    mimeType: file.type,
  });

  return NextResponse.json({ success: true });
}
