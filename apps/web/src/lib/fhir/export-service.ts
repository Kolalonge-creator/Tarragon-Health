import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { z } from "zod";
import { loadFhirMapping } from "./config";
import { buildFhirBundle, type BundleResult } from "./export-bundle";
import { exportSections, exportSnapshotSchema, type ExportSection } from "./export-snapshot";

const sectionList = z.array(z.enum(exportSections)).min(1);

export type ExportOutcome =
  | { ok: true; result: BundleResult; requesterKind: string; sectionsIncluded: string[]; sectionsRefused: string[]; mappingVersion: number }
  | { ok: false; status: 400 | 403 | 500; error: string };

/**
 * Asks the database for an export snapshot and maps it to a FHIR Bundle. Every access rule is applied by `fhir_export_snapshot` (the person
 * themself; a supporter only for the categories they hold; staff only through the tie and a written reason, audited): this function adds none
 * of its own and removes none. A refusal is reported as 403 without saying whether the person exists.
 */
export async function exportFhirBundle(
  supabase: SupabaseClient<Database>,
  input: { patientId: string; sections?: string[]; reason?: string }
): Promise<ExportOutcome> {
  let sections: ExportSection[] | undefined;
  if (input.sections && input.sections.length > 0) {
    const parsed = sectionList.safeParse(input.sections);
    if (!parsed.success) return { ok: false, status: 400, error: "unknown section" };
    sections = parsed.data;
  }

  const { data, error } = await supabase.rpc("fhir_export_snapshot", {
    p_patient: input.patientId,
    p_sections: sections,
    p_reason: input.reason,
  });
  if (error) {
    if (error.message.includes("reason of at least 10 characters")) return { ok: false, status: 400, error: "a reason of at least 10 characters is required" };
    if (error.message.includes("unknown section")) return { ok: false, status: 400, error: "unknown section" };
    return { ok: false, status: 500, error: "The export could not be made." };
  }
  const denied = z.object({ status: z.literal("denied") }).safeParse(data);
  if (denied.success) return { ok: false, status: 403, error: "Not permitted" };

  const snapshot = exportSnapshotSchema.safeParse(data);
  if (!snapshot.success) return { ok: false, status: 500, error: "The export could not be read." };

  const { mapping, version } = loadFhirMapping();
  const result = buildFhirBundle(snapshot.data, mapping);
  return {
    ok: true,
    result,
    requesterKind: snapshot.data.requester_kind,
    sectionsIncluded: snapshot.data.sections_included,
    sectionsRefused: snapshot.data.sections_refused,
    mappingVersion: version,
  };
}
