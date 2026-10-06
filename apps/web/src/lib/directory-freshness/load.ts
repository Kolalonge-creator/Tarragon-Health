import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { freshnessRowsSchema, type FreshnessRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

/** A failed read is a load failure the screen says so, never an empty list that looks like "everything is current". */
export async function loadDirectoryFreshness(): Promise<Loaded<FreshnessRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("directory_freshness_list", {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = freshnessRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}
