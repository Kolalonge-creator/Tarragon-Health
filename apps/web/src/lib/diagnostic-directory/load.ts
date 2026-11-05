import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import {
  detailSchema, importBatchesSchema, importRowsSchema, INVESTIGATION_CATEGORIES, investigationOptionsSchema, overviewSchema,
  partnershipsSchema, type Detail, type ImportBatch, type ImportRow, type InvestigationOption, type Overview, type Partnership,
} from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean; missing?: boolean };

/** A failed read is a load failure the screen says so, never an empty list that looks like "nothing to do". */
export async function loadDiagnosticOverview(): Promise<Loaded<Overview>> {
  const { data, error } = await loose(await createClient()).rpc("admin_dx_overview", {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = overviewSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

export async function loadDiagnosticDetail(listingId: string): Promise<Loaded<Detail>> {
  const { data, error } = await loose(await createClient()).rpc("admin_dx_provider_detail", { p_listing_id: listingId });
  if (error) return { ok: false, denied: error.code === "42501" };
  if (data === null) return { ok: false, denied: false, missing: true };
  const parsed = detailSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** Every specific (not ambiguous) investigation in the Phase 1 catalogue, for the service and scope pickers. */
export async function loadInvestigationOptions(): Promise<Loaded<InvestigationOption[]>> {
  const { data, error } = await loose(await createClient())
    .from("reference_concepts")
    .select("id, display, investigation_category, is_ambiguous")
    // Filtered in the query, not after: the terminology table also holds medicines, conditions and analytes, and a capped page
    // of everything could silently drop tests from the picker.
    .in("investigation_category", [...INVESTIGATION_CATEGORIES])
    .eq("is_ambiguous", "false")
    .order("display", { ascending: true });
  if (error) return { ok: false, denied: error.code === "42501" };
  const rows = Array.isArray(data)
    ? data.filter((r: { investigation_category?: unknown; is_ambiguous?: unknown }) => typeof r.investigation_category === "string" && r.is_ambiguous === false)
    : [];
  const parsed = investigationOptionsSchema.safeParse(rows.map((r: { id: unknown; display: unknown; investigation_category: unknown }) => ({
    id: r.id, display: r.display, investigation_category: r.investigation_category,
  })));
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** Preferred Partner history for one provider's branches (Phase 4). */
export async function loadDiagnosticPartnerships(listingId: string): Promise<Loaded<Partnership[]>> {
  const { data, error } = await loose(await createClient()).rpc("admin_dx_partnerships", { p_listing_id: listingId });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = partnershipsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** Phase 7 import: recent batches, and the rows of one batch. */
export async function loadImportBatches(): Promise<Loaded<ImportBatch[]>> {
  const { data, error } = await loose(await createClient()).rpc("admin_dx_import_batches", {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = importBatchesSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

export async function loadImportRows(batchId: string): Promise<Loaded<ImportRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("admin_dx_import_rows", { p_batch_id: batchId });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = importRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}
