import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { inviteRowsSchema, type InviteRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

export async function loadInvites(): Promise<Loaded<InviteRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("signup_invites_list", {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = inviteRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** Whether invite-only sign-up is on. A failed read is reported as unknown, never as "off". */
export async function loadInviteOnly(): Promise<boolean | null> {
  const { data, error } = await loose(await createClient()).rpc("platform_switch_is_on", { p_key: "signup_invites_required" });
  if (error || typeof data !== "boolean") return null;
  return data;
}
