import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { collectionExtrasSchema, type CollectionExtra } from "./model";

export type ExtrasLoaded = { ok: true; data: CollectionExtra[] } | { ok: false };

/**
 * S28e: which waiting prescriptions were sent together, and which the pharmacy has said it has. The list still works without this (it just shows
 * every prescription on its own), so a failed read is returned and the page says the grouping is missing, never that nothing is grouped.
 */
export async function loadCollectionExtras(): Promise<ExtrasLoaded> {
  const { data, error } = await loose(await createClient()).rpc("pharmacist_collection_extras", {});
  if (error) return { ok: false };
  const parsed = collectionExtrasSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}
