import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { outcomeSchema, staffContextSchema, staffRefusalText, type StaffContext } from "@/lib/community/model";
import type { StaffActionResult } from "./staff-types";

/**
 * Server-side helpers shared by the Community staff screens. Authorisation is the database's job (auth.uid() inside each function):
 * nothing here trusts a role the browser sent.
 */

/** Who the signed-in person is for Community. Cached per request, so the layout, the nav and the page cost one call between them. */
export const getCommunityStaffContext = cache(async (): Promise<StaffContext | null> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("community_staff_context");
    if (error) return null;
    const parsed = staffContextSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
});

export const GENERIC_FAILURE = "That could not be done. Please try again.";

/** A database error becomes a calm sentence. The error text itself is never returned. */
export function failureMessage(error: { code?: string } | null | undefined, overrides: Readonly<Record<string, string>> = {}): string {
  const code = error?.code;
  if (code !== undefined && Object.hasOwn(overrides, code)) return overrides[code];
  if (code === "42501") return "You do not have permission to do that.";
  if (code === "28000") return "Please sign in again.";
  return GENERIC_FAILURE;
}

/**
 * Turns an RPC reply into a result. `okStatuses` maps each success status to its message; any other reply is a refusal and its reason
 * is turned into plain English by staffRefusalText.
 */
export function toResult(
  data: unknown,
  error: { code?: string } | null,
  okStatuses: Readonly<Record<string, string>>,
  errorOverrides: Readonly<Record<string, string>> = {},
): StaffActionResult {
  if (error) return { ok: false, message: failureMessage(error, errorOverrides) };
  const parsed = outcomeSchema.safeParse(data);
  if (!parsed.success) return { ok: false, message: GENERIC_FAILURE };
  const { status, reason } = parsed.data;
  if (Object.hasOwn(okStatuses, status)) return { ok: true, message: okStatuses[status] };
  return { ok: false, message: staffRefusalText(reason) };
}
