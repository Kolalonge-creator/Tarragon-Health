import { z } from "zod";
import type { RecordChangeAllergy, RecordChangeCondition } from "./record-changes-queue";

/**
 * Staff cannot read `patient_allergies` or `patient_conditions` directly any more (S05c closed every staff SELECT on them), so the
 * current record shown beside a request comes from the audited chart reader, `read_patient_chart_audited`, which checks the clinician's
 * tie and the patient's access categories and writes the access to the audit trail (INV-10). The `allergies` section is a view that
 * renames allergen to substance; the `conditions` section renames condition_name to display and icd10_code to code.
 */
export const CHART_READ_REASON = "Reviewing a change the patient asked for in their record";

export type RecordChangeKind = "allergy" | "condition";

const chartAllergySchema = z.object({
  id: z.string(),
  substance: z.string(),
  reaction: z.string().nullable().optional(),
  severity: z.enum(["mild", "moderate", "severe"]).nullable().optional(),
  source: z.string(),
  noted_at: z.string().nullable().optional(),
});

const chartConditionSchema = z.object({
  id: z.string(),
  display: z.string(),
  code: z.string().nullable().optional(),
  status: z.string(),
  source: z.string(),
  date_identified: z.string().nullable().optional(),
});

const chartResponseSchema = z.object({
  status: z.string(),
  sections: z
    .object({
      allergies: z.array(chartAllergySchema).optional(),
      conditions: z.array(chartConditionSchema).optional(),
    })
    .optional(),
});

/**
 * One rule for every section: null when the reader refused (status "denied"), answered in a shape we do not know, or did not
 * return the section; otherwise the rows keyed by id. Null means "could not load", never "none"; an empty map means "really gone".
 */
function parseSection<Row extends { id: string }, Out>(
  payload: unknown,
  section: "allergies" | "conditions",
  toOut: (row: Row) => Out,
): Map<string, Out> | null {
  const parsed = chartResponseSchema.safeParse(payload);
  if (!parsed.success) return null;
  if (parsed.data.status === "denied") return null;
  const rows = parsed.data.sections?.[section] as Row[] | undefined;
  if (!rows) return null;
  return new Map(rows.map((row) => [row.id, toOut(row)]));
}

/** The patient's allergies keyed by id (the chart view renames allergen to substance). */
export function parseChartAllergies(payload: unknown): Map<string, RecordChangeAllergy> | null {
  return parseSection(payload, "allergies", (row: z.infer<typeof chartAllergySchema>) => ({
    allergen: row.substance,
    reaction: row.reaction ?? null,
    severity: row.severity ?? null,
    source: row.source,
    noted_at: row.noted_at ?? null,
  }));
}

/** The patient's conditions keyed by id (the chart view renames condition_name to display and icd10_code to code). */
export function parseChartConditions(payload: unknown): Map<string, RecordChangeCondition> | null {
  return parseSection(payload, "conditions", (row: z.infer<typeof chartConditionSchema>) => ({
    condition_name: row.display,
    icd10_code: row.code ?? null,
    status: row.status,
    source: row.source,
    date_identified: row.date_identified ?? null,
  }));
}

type ChartReader = {
  rpc: (
    fn: "read_patient_chart_audited",
    args: { p_patient: string; p_sections: string[]; p_reason: string },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export interface CurrentRecords {
  /** null = the allergies could not be loaded for this patient (or were not asked for). */
  allergies: Map<string, RecordChangeAllergy> | null;
  conditions: Map<string, RecordChangeCondition> | null;
}

/**
 * One audited read per distinct patient, asking only for the sections that patient's waiting requests need. A section that was asked
 * for and could not be loaded is null in the result (so the screen says "could not be loaded", never "gone"); `failed` lists the
 * patients with at least one such section.
 */
export async function loadCurrentRecords(
  supabase: ChartReader,
  needs: Array<{ patientId: string; kind: RecordChangeKind }>,
): Promise<{ byPatient: Map<string, CurrentRecords>; failed: string[] }> {
  const kindsByPatient = new Map<string, Set<RecordChangeKind>>();
  for (const { patientId, kind } of needs) {
    const kinds = kindsByPatient.get(patientId) ?? new Set<RecordChangeKind>();
    kinds.add(kind);
    kindsByPatient.set(patientId, kinds);
  }
  const results = await Promise.all(
    [...kindsByPatient].map(async ([patientId, kinds]) => {
      const sections = [...kinds].map((kind) => (kind === "allergy" ? "allergies" : "conditions"));
      const { data, error } = await supabase.rpc("read_patient_chart_audited", {
        p_patient: patientId,
        p_sections: sections,
        p_reason: CHART_READ_REASON,
      });
      const records: CurrentRecords = {
        allergies: !error && kinds.has("allergy") ? parseChartAllergies(data) : null,
        conditions: !error && kinds.has("condition") ? parseChartConditions(data) : null,
      };
      const ok = (!kinds.has("allergy") || records.allergies !== null) && (!kinds.has("condition") || records.conditions !== null);
      return { patientId, records, ok };
    }),
  );
  const byPatient = new Map<string, CurrentRecords>();
  const failed: string[] = [];
  for (const { patientId, records, ok } of results) {
    byPatient.set(patientId, records);
    if (!ok) failed.push(patientId);
  }
  return { byPatient, failed };
}
