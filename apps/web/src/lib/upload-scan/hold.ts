import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * T2-08 hold: a stored file whose intake document is 'pending_scan' (scanner was down when it arrived) or 'infected' must not be
 * handed out as a signed link and must not be read by an AI reader. Every signing point and every reader asks here first, with
 * the paths it is about to use. Works with any client (patient, staff or service role): public.upload_scan_held_paths only ever
 * answers "held or not" for a path the caller already holds.
 *
 * If the check itself fails: when the scanner is configured, every path is treated as held (fail closed, a file is withheld for a
 * moment rather than a possibly harmful one shown); when it is not configured there can be nothing held, so nothing is.
 */
export async function heldPaths(client: SupabaseClient<Database>, paths: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const wanted = [...new Set(paths.filter((p): p is string => typeof p === "string" && p.length > 0))];
  if (wanted.length === 0) return new Set();
  try {
    const { data, error } = await client.rpc("upload_scan_held_paths", { p_paths: wanted });
    if (error) throw error;
    return new Set((data ?? []) as string[]);
  } catch (error) {
    console.error("upload-scan: could not check held files", error);
    return process.env.SCANNER_SERVICE_URL ? new Set(wanted) : new Set();
  }
}

export async function isPathHeld(client: SupabaseClient<Database>, path: string | null | undefined): Promise<boolean> {
  if (!path) return false;
  return (await heldPaths(client, [path])).has(path);
}

/** What a reader returns, without persisting a failure, when its file is held. */
export const HELD_FOR_SCAN_MESSAGE = "This file is still being checked for safety. It will be read once the check has finished.";
