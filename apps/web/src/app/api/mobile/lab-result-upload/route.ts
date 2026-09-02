import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { runLabReportExtraction } from "@/lib/lab-reports/extraction-actions";
import { patientResultUploadSchema, validateResultDocFile } from "@/lib/validation/lab-result-documents";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

/** The stable, machine-readable marker
 * public.claim_lab_result_consult_credit raises in its error DETAIL when no
 * unclaimed, paid request is found — never pattern-match on its message
 * text, which is free to change. */
const CONSULT_FEE_REQUIRED_DETAIL = "CONSULT_FEE_REQUIRED";

/**
 * Native camera-capture lab result upload for the Expo mobile app
 * (MOBILE_APP_SPEC.md §2.5) — mirrors uploadResultDocumentAsPatient in
 * apps/web/src/lib/lab-results/actions.ts: same own-uid-folder storage
 * upload (the bearer-authenticated client enforces the identical "your own
 * folder only" RLS policy a cookie session would), same
 * lab_result_documents insert (source pinned to 'patient', patient_id from
 * the session — never the client), same runLabReportExtraction structured
 * read so a photographed result becomes trendable numbers exactly like a
 * web upload, and — founder rule, 2026-08-30 — the same one-off ₦10,000
 * consultation-fee gate via public.claim_lab_result_consult_credit /
 * public.settle_lab_result_consult_claim, called before/after the upload
 * exactly as the web action does. A Server Action can't be invoked from a
 * bare fetch, hence a Route Handler mirror rather than reuse — same
 * reasoning as every other /api/mobile/* route.
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
    return NextResponse.json({ error: "Attach the result file (PDF or photo)." }, { status: 400 });
  }
  const fileError = validateResultDocFile(file);
  if (fileError) {
    return NextResponse.json({ error: fileError }, { status: 400 });
  }

  const parsed = patientResultUploadSchema.safeParse({
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

  // The consultation-fee gate — called BEFORE the storage upload so an
  // unpaid patient never wastes one. See the web action's comment for the
  // full mechanics (claim/settle, network-billed exemption).
  let claimedRequestId: string | null = null;
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_lab_result_consult_credit",
    { p_patient_id: user.id, p_lab_order_id: labOrderId ?? null },
  );
  if (claimError) {
    if (claimError.details === CONSULT_FEE_REQUIRED_DETAIL) {
      return NextResponse.json(
        {
          error:
            "Pay the ₦10,000 lab-result consultation fee to upload this result — it also books you a 15-minute call with a doctor to walk through it.",
          requiresConsultFeePayment: true,
        },
        { status: 402 },
      );
    }
    return NextResponse.json({ error: claimError.message }, { status: 400 });
  }
  claimedRequestId = claimed ?? null;

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  // Leading folder MUST be the caller's uid — the storage own-folder policy
  // checks exactly this, same as the web patient-upload path.
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(RESULT_DOC_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    if (claimedRequestId) {
      await supabase.rpc("settle_lab_result_consult_claim", {
        p_request_id: claimedRequestId,
        p_document_id: null,
      });
    }
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("lab_result_documents")
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
    // Roll back the orphaned object so a failed insert leaves no stray file,
    // and release the claimed credit (see above) for the same reason.
    await supabase.storage.from(RESULT_DOC_BUCKET).remove([path]);
    if (claimedRequestId) {
      await supabase.rpc("settle_lab_result_consult_claim", {
        p_request_id: claimedRequestId,
        p_document_id: null,
      });
    }
    return NextResponse.json(
      { error: insertError?.message ?? "Could not save that upload." },
      { status: 500 }
    );
  }

  if (claimedRequestId) {
    await supabase.rpc("settle_lab_result_consult_claim", {
      p_request_id: claimedRequestId,
      p_document_id: inserted.id,
    });
  }

  // Never throws — a failed read just persists a 'failed' extraction row and
  // leaves the manual review path intact.
  await runLabReportExtraction(createServiceRoleClient(), {
    documentId: inserted.id,
    organisationId: me.organisation_id,
    patientId: user.id,
    filePath: path,
    mimeType: file.type,
  });

  return NextResponse.json({ success: true });
}
