"use server";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loadDirectory, type LoadResult } from "./load";
import { queryInput } from "./model";

/**
 * Runs with the signed-in admin's own session (never the service role) so the database function sees the real caller, re-checks the
 * admin role and writes the audit row. The typed search goes in the request body, never the address.
 */
export async function loadDirectoryAction(input: unknown): Promise<LoadResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "denied" };
  const parsed = queryInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "query" };
  return loadDirectory(await createClient(), parsed.data);
}
