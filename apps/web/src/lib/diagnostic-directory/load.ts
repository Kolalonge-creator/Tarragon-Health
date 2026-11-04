import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { detailSchema, investigationOptionsSchema, overviewSchema, type Detail, type InvestigationOption, type Overview } from "./model";

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
