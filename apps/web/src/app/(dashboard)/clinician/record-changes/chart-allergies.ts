import { z } from "zod";
import type { RecordChangeAllergy } from "./record-changes-queue";

/**
 * Staff cannot read `patient_allergies` directly any more (S05c closed every staff SELECT on it), so the
 * current record shown beside a request comes from the audited chart reader, `read_patient_chart_audited`,
 * which checks the clinician's tie and the patient's access categories and writes the access to the audit
 * trail (INV-10). The `allergies` section is a view over `patient_allergies` that renames allergen to substance.
 */
export const CHART_READ_REASON = "Reviewing a change the patient asked for in their record";

const chartAllergySchema = z.object({
  id: z.string(),
  substance: z.string(),
  reaction: z.string().nullable().optional(),
  severity: z.enum(["mild", "moderate", "severe"]).nullable().optional(),
  source: z.string(),
  noted_at: z.string().nullable().optional(),
});

const chartResponseSchema = z.object({
  status: z.string(),
  sections: z.object({ allergies: z.array(chartAllergySchema).optional() }).optional(),
});

/**
 * The patient's allergies keyed by id, or null when the reader refused (status "denied"), answered in a shape
 * we do not know, or did not return the allergies section. Null means "could not load", never "none".
 */
export function parseChartAllergies(payload: unknown): Map<string, RecordChangeAllergy> | null {
  const parsed = chartResponseSchema.safeParse(payload);
  if (!parsed.success) return null;
  if (parsed.data.status === "denied") return null;
  const rows = parsed.data.sections?.allergies;
  if (!rows) return null;
  return new Map(
    rows.map((row) => [
      row.id,
      {
        allergen: row.substance,
        reaction: row.reaction ?? null,
        severity: row.severity ?? null,
        source: row.source,
        noted_at: row.noted_at ?? null,
      },
    ]),
  );
}

type ChartReader = {
  rpc: (
    fn: "read_patient_chart_audited",
    args: { p_patient: string; p_sections: string[]; p_reason: string },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** One audited read per distinct patient. A patient whose record could not be loaded is absent from the result. */
export async function loadCurrentAllergies(
  supabase: ChartReader,
  patientIds: string[],
): Promise<{ byPatient: Map<string, Map<string, RecordChangeAllergy>>; failed: string[] }> {
  const distinct = [...new Set(patientIds)];
  const results = await Promise.all(
    distinct.map(async (patientId) => {
      const { data, error } = await supabase.rpc("read_patient_chart_audited", {
        p_patient: patientId,
        p_sections: ["allergies"],
        p_reason: CHART_READ_REASON,
      });
      return { patientId, allergies: error ? null : parseChartAllergies(data) };
    }),
  );
  const byPatient = new Map<string, Map<string, RecordChangeAllergy>>();
  const failed: string[] = [];
  for (const { patientId, allergies } of results) {
    if (allergies) byPatient.set(patientId, allergies);
    else failed.push(patientId);
  }
  return { byPatient, failed };
}
