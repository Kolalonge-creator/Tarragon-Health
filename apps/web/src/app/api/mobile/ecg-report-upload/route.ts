import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ECG_REPORT_BUCKET } from "@/lib/ecg-reports/documents";
import { runEcgReportExtraction } from "@/lib/ecg-reports/extraction-actions";
import { patientEcgUploadSchema, validateEcgDocFile } from "@/lib/validation/ecg-report-documents";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/**
 * Native counterpart to uploadEcgReportAsPatient
 * (apps/web/src/lib/ecg-reports/actions.ts) — same own-uid-folder storage
 * upload, same ecg_report_documents insert (source pinned to 'patient'),
 * same runEcgReportExtraction read. Mirrors
 * /api/mobile/lab-result-upload/route.ts's bearer-auth shape exactly; a
 * Server Action can't be invoked from a bare fetch, hence a Route Handler.
 *
 * Never existed on mobile before this — the per-test checklist
 * (lab-order-test-checklist.tsx's native counterpart) is the first native
 * surface that needs to upload an ECG specifically rather than route
 * everything through the generic lab-result-upload endpoint.
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
    return NextResponse.json({ error: "Attach the ECG file (PDF or photo)." }, { status: 400 });
  }
  const fileError = validateEcgDocFile(file);
  if (fileError) {
    return NextResponse.json({ error: fileError }, { status: 400 });
  }

  const parsed = patientEcgUploadSchema.safeParse({
    lab_order_id: formData.get("lab_order_id") || undefined,
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { lab_order_id: labOrderId, note } = parsed.data;

  const { data: me } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!me?.organisation_id) {
    return NextResponse.json(
      { error: "Your account isn't set up for uploads yet. Message your care team." },
      { status: 400 }
    );
  }

  if (labOrderId) {
    const { data: order } = await supabase
      .from("lab_orders")
      .select("id")
      .eq("id", labOrderId)
      .eq("patient_id", user.id)
      .maybeSingle();
    if (!order) {
      return NextResponse.json({ error: "That test request isn't on your record." }, { status: 400 });
    }
  }

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(ECG_REPORT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("ecg_report_documents")
    .insert({
      organisation_id: me.organisation_id,
      patient_id: user.id,
      lab_order_id: labOrderId ?? null,
      file_path: path,
      original_filename: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
      source: "patient",
      uploaded_by: user.id,
      note: note ?? null,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    await supabase.storage.from(ECG_REPORT_BUCKET).remove([path]);
    return NextResponse.json(
      { error: insertError?.message ?? "Could not save that upload." },
      { status: 500 }
    );
  }

  await runEcgReportExtraction(createServiceRoleClient(), {
    documentId: inserted.id,
    organisationId: me.organisation_id,
    patientId: user.id,
    filePath: path,
    mimeType: file.type,
  });

  return NextResponse.json({ success: true });
}
