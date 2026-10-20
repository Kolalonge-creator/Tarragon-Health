import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { z } from "zod";
import { loadFhirMapping, loadIpsMapping } from "./config";
import { buildFhirBundle, type BundleResult } from "./export-bundle";
import { exportSections, exportSnapshotSchema, type ExportSection, type ExportSnapshot } from "./export-snapshot";
import { buildIpsBundle, type IpsResult } from "./ips-bundle";

const sectionList = z.array(z.enum(exportSections)).min(1);

export type ExportOutcome =
  | { ok: true; result: BundleResult; requesterKind: string; sectionsIncluded: string[]; sectionsRefused: string[]; mappingVersion: number }
  | { ok: false; status: 400 | 403 | 500; error: string };

type SnapshotOutcome = { ok: true; snapshot: ExportSnapshot } | { ok: false; status: 400 | 403 | 500; error: string };

async function fetchSnapshot(
  supabase: SupabaseClient<Database>,
  input: { patientId: string; sections?: string[]; reason?: string }
): Promise<SnapshotOutcome> {
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
  return { ok: true, snapshot: snapshot.data };
}

/**
 * Asks the database for an export snapshot and maps it to a FHIR Bundle. Every access rule is applied by `fhir_export_snapshot` (the person
 * themself; a supporter only for the categories they hold; staff only through the tie and a written reason, audited): this function adds none
 * of its own and removes none. A refusal is reported as 403 without saying whether the person exists.
 */
export async function exportFhirBundle(
  supabase: SupabaseClient<Database>,
  input: { patientId: string; sections?: string[]; reason?: string }
): Promise<ExportOutcome> {
  const got = await fetchSnapshot(supabase, input);
  if (!got.ok) return got;
  const { mapping, version } = loadFhirMapping();
  const result = buildFhirBundle(got.snapshot, mapping);
  return {
    ok: true,
    result,
    requesterKind: got.snapshot.requester_kind,
    sectionsIncluded: got.snapshot.sections_included,
    sectionsRefused: got.snapshot.sections_refused,
    mappingVersion: version,
  };
}

/** The sections an International Patient Summary draws on. Documents are not among them: the IPS has no documents section. */
export const IPS_SECTIONS: ExportSection[] = ["vitals", "lab_results", "medications", "conditions", "allergies", "immunizations"];

export type IpsOutcome =
  | { ok: true; result: IpsResult; requesterKind: string; sectionsIncluded: string[]; sectionsRefused: string[]; mappingVersion: number; ipsMappingVersion: number }
  | { ok: false; status: 400 | 403 | 500; error: string };

/**
 * The same database snapshot and the same access rules as `exportFhirBundle` (it is the one call, so it is audited the same way, in
 * `fhir_export_log`), restricted to the IPS sections and shaped as an IPS-style document Bundle.
 */
export async function exportIpsBundle(supabase: SupabaseClient<Database>, input: { patientId: string; reason?: string }): Promise<IpsOutcome> {
  const got = await fetchSnapshot(supabase, { patientId: input.patientId, sections: IPS_SECTIONS, reason: input.reason });
  if (!got.ok) return got;
  try {
    const { mapping, version } = loadFhirMapping();
    const { ips, version: ipsMappingVersion } = loadIpsMapping();
    const result = buildIpsBundle(got.snapshot, mapping, ips);
    return {
      ok: true,
      result,
      requesterKind: got.snapshot.requester_kind,
      sectionsIncluded: got.snapshot.sections_included,
      sectionsRefused: got.snapshot.sections_refused,
      mappingVersion: version,
      ipsMappingVersion,
    };
  } catch {
    // a configuration that no longer parses, or a mapper fault, is a plain failure the caller can show, never an unhandled throw
    return { ok: false, status: 500, error: "The export could not be made." };
  }
}
