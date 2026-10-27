import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { backlogRowsSchema, type BacklogRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

/** A failed read is a load failure the screen says so, never an empty list that looks like "nothing is waiting". */
export async function loadContentReviewBacklog(): Promise<Loaded<BacklogRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("content_review_backlog", { p_limit: 1000 });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = backlogRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}
