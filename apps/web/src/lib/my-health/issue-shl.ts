import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { buildShlink } from "@/lib/my-health/smart-health-link";

export type IssueShlResult = { ok: true; link: string } | { ok: false; reason: "not_found" | "unavailable" };

const APP_ORIGIN = (): string => process.env.NEXT_PUBLIC_APP_URL ?? "https://app.tarragonhealth.ng";

/**
 * Makes the SMART Health Link for ONE of the caller's own shares. The client passed in is the caller's (session or bearer), so the
 * `record_shares` read is row-level secured: another person's share id returns nothing, and the answer to "not yours" and "does not exist"
 * is the same. A revoked, expired or locked share gets no link. The key is rebuilt from the token and the server secret each time; it
 * is not stored, so there is nothing here to leak from the database.
 */
export async function issueShlForOwnShare(supabase: SupabaseClient<Database>, shareId: string): Promise<IssueShlResult> {
  const { data, error } = await supabase
    .from("record_shares")
    .select("token, expires_at, is_active, pin_protected, recipient_label, locked_at, revoked_at")
    .eq("id", shareId)
    .maybeSingle();
  if (error) return { ok: false, reason: "unavailable" };
  if (!data) return { ok: false, reason: "not_found" };
  const row = data;
  if (!row.is_active || row.revoked_at || row.locked_at || new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "not_found" };
  }
  const link = buildShlink({
    token: row.token,
    origin: APP_ORIGIN(),
    expiresAt: row.expires_at,
    pinProtected: Boolean(row.pin_protected),
    recipientLabel: row.recipient_label,
  });
  return link ? { ok: true, link } : { ok: false, reason: "unavailable" };
}
