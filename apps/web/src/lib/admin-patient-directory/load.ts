import { loose } from "@/lib/clinician/loose-client";
import type { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE, pageSchema, type DirectoryPage, type DirectoryQuery } from "./model";

export type LoadResult = { ok: true; page: DirectoryPage } | { ok: false; error: "denied" | "query" | "failed" };

/** Reads one page through the audited database function. A failure is returned as a failure, never as an empty directory. */
export async function loadDirectory(supabase: Awaited<ReturnType<typeof createClient>>, q: DirectoryQuery): Promise<LoadResult> {
  const { data, error } = await loose(supabase).rpc("admin_patient_directory", {
    p_search: q.search === "" ? null : q.search,
    p_segment: q.segment,
    p_sort: q.sort,
    p_dir: q.dir,
    p_limit: PAGE_SIZE,
    p_offset: q.page * PAGE_SIZE,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "denied" : error.code === "22023" ? "query" : "failed" };
  const parsed = pageSchema.safeParse(data);
  return parsed.success ? { ok: true, page: parsed.data } : { ok: false, error: "failed" };
}
