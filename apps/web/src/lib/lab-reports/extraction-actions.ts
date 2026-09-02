"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RESULT_DOC_BUCKET } from "@/lib/lab-results/documents";
import { extractLabReport, isLabReportExtractionConfigured } from "./extract";
import { hintsFromConfirmedRows, mergeHints, type TemplateHints } from "./corpus";
import { isReadableDocumentType, normaliseForVision } from "./heic";
import { worstStatusOf, type PatientContext } from "./reference-ranges";
import { confirmLabReportExtractionSchema } from "@/lib/validation/lab-report-extraction";
import { AI_SYSTEMS, decideAiGovernance, recordAiInteraction } from "@/lib/ai-governance";
import { deriveAiSummaryStatus } from "./ai-summary";

export type ExtractionActionResult = { error?: string; success?: boolean; message?: string };

const EXTRACTION_MODEL_ID = "claude-sonnet-5";

/**
 * Only an active clinical_staff member may run or confirm an extraction from
 * the clinician surface.
 *
 * Same gate as `markResultDocumentReviewed`: transcribing a lab report into a
 * patient's permanent record is a clinical act, so a Care Coordinator (org
 * staff, non-clinical) is excluded by the platform's standing write guardrail.
 *
 * The automatic-on-upload path (runLabReportExtraction, below) deliberately
 * does NOT use this gate — a patient uploading their own result has no
 * clinical_staff row, and drafting is not a clinical act. Filing is, and that
 * still goes through this gate and through the confirm RPC's own check.
 */
async function requireClinicalStaff() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!staff) {
    return { error: "Only a Tarragon care-team doctor can file results from a report." as const };
  }
  return { user, supabase, staffId: staff.id };
}

/** Age in whole years, or null when the patient has no recorded date of birth. */
function ageFrom(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const years = (Date.now() - dob.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  return years >= 0 && years < 130 ? Math.floor(years) : null;
}

/**
 * Read an uploaded lab report into a draft, feed the corpus, and raise the
 * review alert's priority if the draft looks critical.
 *
 * Runs under the SERVICE-ROLE client and takes the document's own ids as
 * arguments, because it serves two callers with very different sessions: a
 * clinician pressing "read this report", and the upload path, where the acting
 * session may be a patient uploading their own result. Authorisation is the
 * caller's job and is done before this is reached.
 *
 * NEVER THROWS. Every failure persists a `failed` row and leaves the manual
 * entry form exactly as it was. Extraction being down must never stop a result
 * reaching a doctor.
 */
export async function runLabReportExtraction(
  service: SupabaseClient<Database>,
  params: {
    documentId: string;
    patientId: string;
    organisationId: string;
    filePath: string;
    mimeType: string | null;
    contextHint?: string | null;
  },
): Promise<{ status: "extracted" | "failed"; readyCount: number; message: string }> {
  const { documentId, patientId, organisationId, filePath, mimeType } = params;

  const fail = async (message: string, errorMessage: string) => {
    try {
      await service.from("lab_report_extractions").upsert(
        {
          organisation_id: organisationId,
          patient_id: patientId,
          document_id: documentId,
          model_id: EXTRACTION_MODEL_ID,
          status: "failed",
          rows: [] as unknown as Json,
          error_message: errorMessage,
          report_date: null,
          lab_name: null,
          patient_name_on_report: null,
          unreadable_reason: null,
          confirmed_by: null,
          confirmed_at: null,
          confirmed_codes: [] as unknown as Json,
        },
        { onConflict: "document_id" },
      );
    } catch (error) {
      console.error("lab-reports: could not persist failure", error);
    }
    // -- Patient-facing AI summary status -------------------------------------
    // Every failure path above routes through here, so this covers all of them
    // uniformly rather than duplicating the update at each early return.
    // Deliberately separate from the escalation bridge below: never reads
    // worstStatusOf/reference-ranges.ts, never touches clinician_alerts, and
    // stores no analyte names or values — only a status the patient sees
    // immediately on their own upload, independent of any doctor review.
    try {
      await service
        .from("lab_result_documents")
        .update({
          ai_summary_status: "unavailable",
          ai_summary_generated_at: new Date().toISOString(),
        })
        .eq("id", documentId);
    } catch (error) {
      // Never let this block the failure record from persisting.
      console.error("lab-reports: could not persist AI summary status", error);
    }
    return { status: "failed" as const, readyCount: 0, message };
  };

  if (!mimeType) {
    return fail(
      "This file has no recorded type, so it cannot be read automatically.",
      "No mime type recorded on the document.",
    );
  }
  if (!isReadableDocumentType(mimeType)) {
    return fail(
      "This file type cannot be read automatically. Enter the results by hand.",
      `Unsupported media type: ${mimeType}`,
    );
  }
  if (!isLabReportExtractionConfigured()) {
    return fail(
      "Automatic reading is not configured on this environment.",
      "ANTHROPIC_API_KEY is not set.",
    );
  }

  let fileBase64: string;
  // The media type actually sent to the model, which is not always the one the
  // document was stored under — see normaliseForVision.
  let visionMediaType: string = mimeType;
  try {
    const { data: file, error } = await service.storage.from(RESULT_DOC_BUCKET).download(filePath);
    if (error || !file) throw error ?? new Error("Not found in storage");

    // An iPhone photographing a lab report produces HEIC, which the upload path
    // and the bucket both accept and the vision model cannot read. Converting
    // here is what stops the commonest patient upload in the country from
    // failing straight into "type it in by hand". Never throws: a failed
    // conversion returns the original bytes and falls through to the
    // unsupported-type path below, exactly as before.
    const normalised = await normaliseForVision(
      Buffer.from(await file.arrayBuffer()),
      mimeType,
    );
    fileBase64 = normalised.buffer.toString("base64");
    visionMediaType = normalised.mediaType;
  } catch (error) {
    console.error("lab-reports: could not download document", error);
    return fail("Could not open the stored report file.", "Download failed.");
  }

  // -- AI-005 governance gate -----------------------------------------------
  // Checked here rather than through runGovernedAi() because this function's
  // control flow (a first pass, a corpus lookup, a conditional hinted retry)
  // does not fit the wrapper's run/fallback shape. The two guarantees are the
  // same: the kill switch is honoured before the model is reached, and every
  // outcome reaches ai_interaction_log. The fallback is the one this function
  // already had for every other failure -- the draft does not appear and the
  // manual entry form stands, which is AI-005's recorded fallback_behaviour.
  const governance = await decideAiGovernance(service, AI_SYSTEMS.labReportExtraction.code);
  if (!governance.allow) {
    await recordAiInteraction(service, {
      systemCode: AI_SYSTEMS.labReportExtraction.code,
      modelIdentifier: "none:fallback",
      inputCategory: "lab_report_document",
      status: "fallback",
      subjectProfileId: patientId,
      fallbackReason: governance.message,
      resultingAction: "manual_entry_required",
      resultingEntityType: "lab_report_documents",
      resultingEntityId: documentId,
    });
    return fail(
      "Automatic reading is switched off just now. Enter the results by hand.",
      `AI governance: ${governance.reason}`,
    );
  }

  const startedAt = Date.now();

  // -- First pass, with no learned hints ------------------------------------
  // A laboratory we have never seen is the common case early on, and it must
  // stay the well-tested path. Hints only enter on the retry below.
  let result = await extractLabReport({
    fileBase64,
    mediaType: visionMediaType,
    contextHint: params.contextHint ?? null,
  });

  if (!result.ok) {
    await recordAiInteraction(service, {
      systemCode: AI_SYSTEMS.labReportExtraction.code,
      modelIdentifier: EXTRACTION_MODEL_ID,
      inputCategory: "lab_report_document",
      status: "failed",
      subjectProfileId: patientId,
      errorMessage: `Extraction failed: ${result.reason}`,
      latencyMs: Date.now() - startedAt,
      resultingAction: "manual_entry_required",
      resultingEntityType: "lab_report_documents",
      resultingEntityId: documentId,
    });
    return fail(
      result.reason === "unsupported_type"
        ? "This file type cannot be read automatically. Enter the results by hand."
        : result.reason === "unavailable"
          ? "Automatic reading is not configured on this environment."
          : "Automatic reading failed. Enter the results by hand.",
      `Extraction failed: ${result.reason}`,
    );
  }

  // -- Corpus match ----------------------------------------------------------
  let templateId: string | null = null;
  let storedHints: TemplateHints | null = null;
  const { labNameKey, layoutFingerprint } = result.extraction;

  if (labNameKey && layoutFingerprint) {
    const { data: template } = await service
      .from("lab_report_templates")
      .select("id, hints")
      .eq("lab_name_key", labNameKey)
      .eq("layout_fingerprint", layoutFingerprint)
      .maybeSingle();
    if (template) {
      templateId = template.id;
      storedHints = (template.hints ?? null) as TemplateHints | null;
    }
  }

  // -- Second pass, only when hints would actually help ----------------------
  // Rows the catalogue could not map, or qualitative results whose wording it
  // did not recognise, are exactly what a learned alias list fixes. Re-reading
  // a report that came back clean would spend a second vision call to change
  // nothing, so it is not done.
  const needsHelp = result.extraction.rows.some(
    (r) => r.status === "unmapped" || r.status === "unreadable_value",
  );
  const hasHints =
    storedHints !== null &&
    (Object.keys(storedHints.labelAliases ?? {}).length > 0 ||
      Object.keys(storedHints.unitDefaults ?? {}).length > 0);

  if (needsHelp && hasHints) {
    const retry = await extractLabReport({
      fileBase64,
      mediaType: visionMediaType,
      contextHint: params.contextHint ?? null,
      templateHints: storedHints,
    });
    // Keep the retry only if it genuinely resolved more of the page. A hinted
    // pass that did worse is discarded — a hint must never be able to make a
    // reading worse than the unhinted one.
    if (retry.ok) {
      const before = result.extraction.rows.filter((r) => r.status === "ready").length;
      const after = retry.extraction.rows.filter((r) => r.status === "ready").length;
      if (after > before) result = retry;
    }
  }

  const extraction = result.extraction;
  const rows = extraction.rows;
  const readyCount = rows.filter((r) => r.status === "ready").length;

  // -- Record the sighting in the corpus -------------------------------------
  if (extraction.labNameKey && extraction.layoutFingerprint) {
    try {
      const learned = hintsFromConfirmedRows(rows);
      const { data: id } = await service.rpc("upsert_lab_report_template", {
        p_lab_name: extraction.labName ?? extraction.labNameKey,
        p_lab_name_key: extraction.labNameKey,
        p_layout_fingerprint: extraction.layoutFingerprint,
        p_readings_proposed: readyCount,
        // Sighting-time hints record only what the model MAPPED, which is a
        // weaker signal than a clinician confirming it. The strong signal is
        // written on confirmation.
        p_hints: mergeHints(storedHints, learned) as unknown as Json,
      });
      if (typeof id === "string") templateId = id;
    } catch (error) {
      // The corpus is an optimisation. Never let it block a draft reaching a
      // doctor.
      console.error("lab-reports: corpus upsert failed", error);
    }
  }

  const { error: upsertError } = await service.from("lab_report_extractions").upsert(
    {
      organisation_id: organisationId,
      patient_id: patientId,
      document_id: documentId,
      model_id: EXTRACTION_MODEL_ID,
      status: "extracted",
      rows: rows as unknown as Json,
      report_date: extraction.reportDate,
      lab_name: extraction.labName,
      patient_name_on_report: extraction.patientNameOnReport,
      unreadable_reason: extraction.unreadableReason,
      template_id: templateId,
      lab_name_key: extraction.labNameKey,
      layout_fingerprint: extraction.layoutFingerprint,
      error_message: null,
      confirmed_by: null,
      confirmed_at: null,
      confirmed_codes: [] as unknown as Json,
    },
    { onConflict: "document_id" },
  );
  if (upsertError) {
    return fail("Could not save the draft.", upsertError.message);
  }

  // -- Patient-facing AI summary status ---------------------------------------
  // Deliberately separate from the escalation bridge below: this never reads
  // worstStatusOf/reference-ranges.ts, never touches clinician_alerts, and
  // stores no analyte names or values — only a status the patient sees
  // immediately on their own upload, independent of any doctor review.
  try {
    await service
      .from("lab_result_documents")
      .update({
        ai_summary_status: deriveAiSummaryStatus(rows),
        ai_summary_generated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
  } catch (error) {
    // Never let this block the draft reaching a doctor either.
    console.error("lab-reports: could not persist AI summary status", error);
  }

  // 40.11. The output summary is counts and provenance, never the analyte
  // values themselves -- those live in lab_report_extractions under the
  // patient's own RLS, and a second copy in a staff-readable governance table
  // would widen PHI exposure for no governance benefit.
  await recordAiInteraction(service, {
    systemCode: AI_SYSTEMS.labReportExtraction.code,
    modelIdentifier: EXTRACTION_MODEL_ID,
    inputCategory: "lab_report_document",
    status: "completed",
    subjectProfileId: patientId,
    outputSummary: `${rows.length} row(s) read, ${readyCount} ready for confirmation${
      extraction.labName ? `, lab: ${extraction.labName}` : ""
    }${extraction.unreadableReason ? `, unreadable: ${extraction.unreadableReason}` : ""}`,
    latencyMs: Date.now() - startedAt,
    resultingAction: "draft_awaiting_clinician_confirmation",
    resultingEntityType: "lab_report_documents",
    resultingEntityId: documentId,
  });

  // -- Escalation bridge -----------------------------------------------------
  // A critical-looking DRAFT raises the priority of the review alert that
  // private.handle_lab_result_document already created for this upload. It
  // records no finding, writes nothing to the patient's record and tells the
  // patient nothing — it moves a job a doctor was already going to do further
  // up their queue. That is the whole of it, and the RPC enforces the rest:
  // service-role only, raise-only, and never above 'urgent_escalation'.
  try {
    const { data: profile } = await service
      .from("profiles")
      .select("sex, date_of_birth")
      .eq("id", patientId)
      .maybeSingle();
    const ctx: PatientContext = {
      sex: profile?.sex === "male" || profile?.sex === "female" ? profile.sex : null,
      ageYears: ageFrom(profile?.date_of_birth ?? null),
    };

    const { status, reason } = worstStatusOf(rows, ctx);
    if (status === "critical" && reason) {
      await service.rpc("raise_lab_extraction_alert", {
        p_document_id: documentId,
        p_level: "urgent_escalation",
        p_reason: reason,
      });
      await service
        .from("lab_report_extractions")
        .update({ critical_suspected: true })
        .eq("document_id", documentId);
    }
  } catch (error) {
    // A failure to escalate must never lose the draft. The alert still exists
    // at its normal priority and the document is still in the review queue.
    console.error("lab-reports: escalation bridge failed", error);
  }

  return {
    status: "extracted",
    readyCount,
    message:
      readyCount > 0
        ? `Read ${readyCount} result${readyCount === 1 ? "" : "s"}. Check them against the report before filing.`
        : "Nothing could be read from this report. Enter the results by hand.",
  };
}

/**
 * A clinician asks for an uploaded report to be read (or re-read).
 *
 * Authorisation is the document's own RLS through the caller's session: a
 * clinician cannot extract a document belonging to another organisation's
 * patient. Only after that does the service-role client run.
 */
export async function extractLabReportAction(documentId: string): Promise<ExtractionActionResult> {
  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: doc } = await supabase
    .from("lab_result_documents")
    .select("id, patient_id, organisation_id, file_path, mime_type, lab_order_id")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: "That report is not in your organisation." };

  // Give the model the ordered panel as a hint. The prompt explicitly tells it
  // to transcribe what is on the page regardless — a hint must never become an
  // expectation the model satisfies by inventing rows.
  let contextHint: string | null = null;
  if (doc.lab_order_id) {
    const { data: order } = await supabase
      .from("lab_orders")
      .select("panel_bundle_id, panel_bundles(name)")
      .eq("id", doc.lab_order_id)
      .maybeSingle();
    const bundle = order?.panel_bundles as { name?: string } | null;
    contextHint = bundle?.name ?? null;
  }

  const outcome = await runLabReportExtraction(createServiceRoleClient(), {
    documentId: doc.id,
    patientId: doc.patient_id,
    organisationId: doc.organisation_id,
    filePath: doc.file_path,
    mimeType: doc.mime_type,
    contextHint,
  });

  revalidatePath(`/clinician/patients/${doc.patient_id}`);
  if (outcome.status === "failed") return { error: outcome.message };
  return { success: true, message: outcome.message };
}

/**
 * A clinician confirms the drafted results, filing them into the patient's
 * permanent record.
 *
 * The values written are the ones the REVIEWER submitted, not the ones the
 * model drafted — the review screen lets them correct any figure, and the
 * schema re-validates every code and value from scratch.
 *
 * Filing goes through public.confirm_lab_report_extraction rather than a direct
 * insert, which buys three things a session insert could not: the
 * already-filed check and the write happen in ONE transaction (two review tabs
 * can no longer both file), confirmed_by is derived inside the database from
 * the caller's own active clinical_staff row, and the corrections corpus is
 * written from proposed-versus-confirmed by code that can see both.
 *
 * DELIBERATELY DOES NOT record a `screening_results` row or touch the
 * abnormal-result pipeline. Filing numbers and declaring a result abnormal are
 * two separate clinical acts, and this codebase already draws that line — see
 * `markResultDocumentReviewed`, which says the same thing for the same reason.
 */
export async function confirmLabReportExtraction(
  input: unknown,
): Promise<ExtractionActionResult> {
  const parsed = confirmLabReportExtractionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { extraction_id: extractionId, report_date: reportDate, rows } = parsed.data;

  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  // Read through the caller's own session — the org-staff select policy on
  // lab_report_extractions is the cross-tenant gate.
  const { data: extraction } = await supabase
    .from("lab_report_extractions")
    .select("id, patient_id, template_id")
    .eq("id", extractionId)
    .maybeSingle();
  if (!extraction) return { error: "That extraction is not in your organisation." };

  const { data: filed, error } = await supabase.rpc("confirm_lab_report_extraction", {
    p_extraction_id: extractionId,
    p_readings: rows.map((row) => ({
      code: row.code,
      value: row.value ?? null,
      value_text: row.value_text ?? null,
      unit: row.unit ?? null,
    })) as unknown as Json,
    p_report_date: reportDate,
  });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/patients/${extraction.patient_id}`);
  revalidatePath("/patient");

  const count = typeof filed === "number" ? filed : rows.length;
  return {
    success: true,
    message: `Filed ${count} result${count === 1 ? "" : "s"} to the patient's record.`,
  };
}

/** A reviewer rejects the whole draft — the report still needs entering by hand. */
export async function discardLabReportExtraction(
  extractionId: string,
): Promise<ExtractionActionResult> {
  const gate = await requireClinicalStaff();
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: extraction } = await supabase
    .from("lab_report_extractions")
    .select("id, patient_id, status")
    .eq("id", extractionId)
    .maybeSingle();
  if (!extraction) return { error: "That extraction is not in your organisation." };
  if (extraction.status === "confirmed") {
    return { error: "These results have already been filed and cannot be discarded." };
  }

  const service = createServiceRoleClient();
  await service.from("lab_report_extractions").update({ status: "discarded" }).eq("id", extractionId);

  revalidatePath(`/clinician/patients/${extraction.patient_id}`);
  return { success: true, message: "Draft discarded." };
}
