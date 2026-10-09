"use server";

import { createClient } from "@/lib/supabase/server";
import { UNMASK_NOT_ALLOWED, runUnmask, type UnmaskRpcClient, type UnmaskState } from "@/components/community/unmask-shared";

/**
 * A signed-in doctor (or the Chief Medical Officer) looks up the person behind a community name. The database decides who may, and only
 * while that person has a recent safety concern in that group (COM-6). Raw database text is never returned, and the profile id is
 * never returned to this screen: only the name.
 */
const GENERIC = "That could not be done. Please try again.";

function field(f: FormData, k: string): string {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
}

export async function doctorUnmaskAction(_prev: UnmaskState, f: FormData): Promise<UnmaskState> {
  const client = (await createClient()) as unknown as UnmaskRpcClient;
  return runUnmask(
    client,
    { group_id: field(f, "group_id"), handle: field(f, "handle"), reason: field(f, "reason") },
    (e) => (e.code === "42501" ? UNMASK_NOT_ALLOWED : e.code === "28000" ? "Please sign in again." : GENERIC),
    false,
  );
}
