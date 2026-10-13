import { createClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** The public share door's answer. 'unavailable' covers an unknown, revoked, expired, locked or closed link alike: the caller cannot tell which. */
export type OpenShareResult =
  | { kind: "ok"; record: Record<string, unknown> & { status: "ok" } }
  | { kind: "pin_required"; attemptsLeft: number | null }
  | { kind: "try_later" }
  | { kind: "unavailable" };

const PIN_FORMAT = /^[0-9]{4,12}$/;

export function isWellFormedPin(pin: string): boolean {
  return PIN_FORMAT.test(pin);
}

/**
 * Calls the anon-callable `record_share_by_token` with a bare anon client (no session, so a signed-in viewer is treated like anyone else).
 * `clientKey` is the viewer's network address as the platform sees it; the database stores only a hash, to rate-limit wrong PINs per client.
 * Any transport or parse failure is 'unavailable', never a thrown error and never a partial record.
 */
export async function openShare(token: string, pin: string | null, clientKey: string | null): Promise<OpenShareResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { kind: "unavailable" };
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("record_share_by_token", {
    p_token: token,
    ...(pin ? { p_pin: pin } : {}),
    ...(clientKey ? { p_client_key: clientKey } : {}),
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return { kind: "unavailable" };
  const body = data as Record<string, unknown>;
  switch (body.status) {
    case "ok":
      return { kind: "ok", record: body as Record<string, unknown> & { status: "ok" } };
    case "pin_required":
      return { kind: "pin_required", attemptsLeft: typeof body.attempts_left === "number" ? body.attempts_left : null };
    case "try_later":
      return { kind: "try_later" };
    default:
      return { kind: "unavailable" };
  }
}
