"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { generateLabResultExtraction } from "./generate";
import {
  EXTRACTABLE_ANALYTE_CODES,
  CANONICAL_UNIT,
  type ExtractableAnalyteCode,
} from "./analytes";

export type ExtractionActionResult = { error?: string; success?: boolean };

/**
 * Read (or re-read) an uploaded document into structured proposals.
 *
 * Authorisation is the document's own RLS: the caller must be able to SELECT
 * the lab_result_documents row through their own session. Only after that does
 * the service-role client run, and only to download the file and write the
 * proposal — never to widen who can see anything.
 *
 * Safe to call speculatively: generateLabResultExtraction never throws.
 */
export async function extractLabResultAction(
  documentId: string
): Promise<ExtractionActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("lab_result_documents")
    .select("id, organisation_id, patient_id, file_path, mime_type")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: "Result not found." };

  const outcome = await generateLabResultExtraction(createServiceRoleClient(), {
    documentId: doc.id,
    organisationId: doc.organisation_id,
    patientId: doc.patient_id,
    filePath: doc.file_path,
    mimeType: doc.mime_type,
  });

  revalidatePath(`/clinician/patients/${doc.patient_id}`);
  if (outcome.status === "failed") {
    return { error: "Could not read that document automatically. Please read it by hand." };
  }
  return { success: true };
}

const confirmSchema = z.object({
  extraction_id: z.string().uuid(),
  readings: z
    .array(
      z.object({
        code: z.enum(EXTRACTABLE_ANALYTE_CODES),
        value: z.number().finite(),
        taken_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .min(1)
    .max(20),
});

/**
 * A clinician confirms the values they accept from an extraction, which is the
 * only path from a machine reading into the clinical record.
 *
 * The unit is NOT taken from the caller: it is re-derived server-side from the
 * canonical map for each code, so a tampered or stale client cannot land a
 * value on the wrong scale. The values themselves may legitimately differ from
 * what was proposed — correcting a misread is the entire point of the review.
 *
 * public.confirm_lab_result_extraction does the rest: it requires an active
 * clinical_staff row in the extraction's own organisation, stamps confirmed_by
 * from the caller's session rather than any input, and refuses a second
 * confirmation.
 */
export async function confirmLabResultExtractionAction(input: {
  extractionId: string;
  readings: { code: string; value: number; takenOn?: string | null }[];
}): Promise<ExtractionActionResult> {
  const parsed = confirmSchema.safeParse({
    extraction_id: input.extractionId,
    readings: input.readings.map((r) => ({
      code: r.code,
      value: r.value,
      taken_on: r.takenOn ?? undefined,
    })),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values and try again." };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_lab_result_extraction", {
    p_extraction_id: parsed.data.extraction_id,
    p_readings: parsed.data.readings.map((r) => ({
      code: r.code,
      value: r.value,
      unit: CANONICAL_UNIT[r.code as ExtractableAnalyteCode],
      taken_on: r.taken_on ?? null,
    })),
  });
  if (error) return { error: error.message };

  revalidatePath("/clinician");
  return { success: true };
}
