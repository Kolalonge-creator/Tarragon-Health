"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CERTIFICATE_BUCKET } from "@/lib/queries/vaccination";
import { generateVaccinationScheduleBestEffort } from "@/lib/preventive/generate-vaccination-schedule";
import { isReadableDocumentType, normaliseForVision } from "@/lib/lab-reports/heic";
import {
  extractVaccinationCard,
  isVaccinationCardExtractionConfigured,
  type VaccinationCatalogueEntry,
} from "./extract";
import { confirmVaccinationCardExtractionSchema } from "@/lib/validation/vaccination";

export type CardExtractionActionResult = { error?: string; success?: boolean; message?: string };

const EXTRACTION_MODEL_ID = "claude-sonnet-5";

/**
 * Same authority as logging a dose directly: the patient themselves, a
 * 'manage'-level caregiver, or org staff. Unlike the lab/ECG extraction
 * panels, there is deliberately no clinical-staff gate here — vaccination
 * self-log has never required one, and reading/confirming a card is the
 * same act as typing the same values into LogVaccinationForm by hand.
 */
async function requireCardAccess(patientId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };

  const supabase = await createClient();
  if (user.id !== patientId) {
    const [{ data: staff }, { data: grant }] = await Promise.all([
      supabase.from("profiles").select("organisation_id").eq("id", user.id).maybeSingle(),
      supabase
        .from("profile_access")
        .select("permission_level")
        .eq("profile_id", patientId)
        .eq("grantee_user_id", user.id)
        .maybeSingle(),
    ]);
    const isManageGrantee = grant?.permission_level === "manage";
    if (!isManageGrantee && !staff) {
      return { error: "Not authorised to manage this vaccination card." as const };
    }
  }
  return { user, supabase };
}

/**
 * Read an uploaded card into a draft. Runs under the SERVICE-ROLE client and
 * takes the extraction's own id, so it can be called right after upload
 * regardless of the acting session. Authorisation is the caller's job and is
 * done before this is reached.
 *
 * NEVER THROWS. Every failure persists a `failed` row and leaves manual
 * entry via LogVaccinationForm completely intact.
 */
export async function runVaccinationCardExtraction(
  service: SupabaseClient<Database>,
  extractionId: string
): Promise<{ status: "extracted" | "failed"; readyCount: number; message: string }> {
  const { data: row } = await service
    .from("vaccination_card_extractions")
    .select("id, patient_id, organisation_id, source_path")
    .eq("id", extractionId)
    .maybeSingle();
  if (!row) {
    return { status: "failed", readyCount: 0, message: "That upload could not be found." };
  }

  const fail = async (message: string, errorMessage: string) => {
    await service
      .from("vaccination_card_extractions")
      .update({ status: "failed", error_message: errorMessage })
      .eq("id", extractionId);
    return { status: "failed" as const, readyCount: 0, message };
  };

  if (!isVaccinationCardExtractionConfigured()) {
    return fail(
      "Automatic reading is not configured on this environment.",
      "ANTHROPIC_API_KEY is not set."
    );
  }

  let fileBase64: string;
  let visionMediaType: string;
  try {
    const { data: file, error } = await service.storage
      .from(CERTIFICATE_BUCKET)
      .download(row.source_path);
    if (error || !file) throw error ?? new Error("Not found in storage");

    const mimeType = file.type || null;
    if (!isReadableDocumentType(mimeType)) {
      return fail(
        "This file type cannot be read automatically. Enter the doses by hand.",
        `Unsupported media type: ${mimeType}`
      );
    }

    // An iPhone photographing a card produces HEIC, which the bucket accepts
    // and the vision model cannot read — same fix as lab-reports/ecg-reports.
    const normalised = await normaliseForVision(Buffer.from(await file.arrayBuffer()), mimeType);
    fileBase64 = normalised.buffer.toString("base64");
    visionMediaType = normalised.mediaType;
  } catch (error) {
    console.error("vaccination-cards: could not download upload", error);
    return fail("Could not open the uploaded file.", "Download failed.");
  }

  const { data: catalog } = await service
    .from("vaccination_catalog")
    .select("id, code, name")
    .eq("is_active", true);

  const result = await extractVaccinationCard({
    fileBase64,
    mediaType: visionMediaType,
    catalog: (catalog ?? []) as VaccinationCatalogueEntry[],
  });

  if (!result.ok) {
    return fail(
      result.reason === "unsupported_type"
        ? "This file type cannot be read automatically. Enter the doses by hand."
        : result.reason === "unavailable"
          ? "Automatic reading is not configured on this environment."
          : "Automatic reading failed. Enter the doses by hand.",
      `Extraction failed: ${result.reason}`
    );
  }

  const { extraction } = result;
  const readyCount = extraction.rows.filter((r) => r.status === "ready").length;

  const { error: updateError } = await service
    .from("vaccination_card_extractions")
    .update({
      status: "extracted",
      model_id: EXTRACTION_MODEL_ID,
      rows: extraction.rows as unknown as Json,
      card_holder_name: extraction.cardHolderName,
      unreadable_reason: extraction.unreadableReason,
      error_message: null,
    })
    .eq("id", extractionId);
  if (updateError) {
    return fail("Could not save the draft.", updateError.message);
  }

  return {
    status: "extracted",
    readyCount,
    message:
      readyCount > 0
        ? `Read ${readyCount} dose${readyCount === 1 ? "" : "s"}. Check them against the card before filing.`
        : "Nothing could be read from this upload. Enter the doses by hand.",
  };
}

/** The patient (or a caregiver managing them) asks for an uploaded card to be read. */
export async function extractVaccinationCardAction(
  extractionId: string
): Promise<CardExtractionActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // The extraction's own RLS select policy is the cross-tenant/ownership gate.
  const { data: row } = await supabase
    .from("vaccination_card_extractions")
    .select("id, patient_id")
    .eq("id", extractionId)
    .maybeSingle();
  if (!row) return { error: "That upload is not visible to you." };

  const gate = await requireCardAccess(row.patient_id);
  if ("error" in gate) return { error: gate.error };

  const outcome = await runVaccinationCardExtraction(createServiceRoleClient(), extractionId);

  revalidatePath("/patient");
  if (outcome.status === "failed") return { error: outcome.message };
  return { success: true, message: outcome.message };
}

/**
 * Files the reviewer's accepted rows into vaccination_records, atomically,
 * via confirm_vaccination_card_extraction() (never a direct insert from
 * here — see that function's own comment for why). Runs through the ACTING
 * user's own session so the RPC's internal auth.uid() genuinely reflects
 * who confirmed it.
 */
export async function confirmVaccinationCardExtractionAction(
  input: unknown
): Promise<CardExtractionActionResult> {
  const parsed = confirmVaccinationCardExtractionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { extraction_id: extractionId, patient_id: patientId, rows } = parsed.data;

  const gate = await requireCardAccess(patientId);
  if ("error" in gate) return { error: gate.error };
  const { supabase } = gate;

  const { data: filed, error } = await supabase.rpc("confirm_vaccination_card_extraction", {
    p_extraction_id: extractionId,
    p_records: rows as unknown as Json,
  });
  if (error) return { error: error.message };

  // Best-effort: rolls the persisted schedule forward now these doses are on
  // file. A failure here never un-files what was just confirmed.
  try {
    const { data: patient } = await supabase
      .from("profiles")
      .select("organisation_id, date_of_birth")
      .eq("id", patientId)
      .maybeSingle();
    if (patient?.organisation_id) {
      await generateVaccinationScheduleBestEffort({
        patientId,
        organisationId: patient.organisation_id,
        ageYears: ageFromDateOfBirth(patient.date_of_birth),
      });
    }
  } catch {
    // Best-effort projection — never surface to the caller.
  }

  revalidatePath("/patient");

  const count = typeof filed === "number" ? filed : rows.length;
  return {
    success: true,
    message: `Filed ${count} dose${count === 1 ? "" : "s"} for your care team to verify.`,
  };
}

/** A reviewer rejects the whole draft — the card still needs entering by hand. */
export async function discardVaccinationCardExtractionAction(
  extractionId: string
): Promise<CardExtractionActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: row } = await supabase
    .from("vaccination_card_extractions")
    .select("id, patient_id, status")
    .eq("id", extractionId)
    .maybeSingle();
  if (!row) return { error: "That upload is not visible to you." };
  if (row.status === "confirmed") {
    return { error: "These doses have already been filed and cannot be discarded." };
  }

  const gate = await requireCardAccess(row.patient_id);
  if ("error" in gate) return { error: gate.error };

  const { error } = await supabase
    .from("vaccination_card_extractions")
    .update({ status: "discarded" })
    .eq("id", extractionId);
  if (error) return { error: error.message };

  revalidatePath("/patient");
  return { success: true, message: "Upload discarded." };
}
