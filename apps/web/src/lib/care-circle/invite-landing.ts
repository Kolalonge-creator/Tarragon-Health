import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isJoinToken, parseInviteLanding, type InviteLanding } from "./join-link";

/**
 * What the signed-out join page may show (supporter join path). Looked up on the server with the service role: the browser never
 * calls public.care_circle_invite_landing, so nobody can try tokens from a script against it, and this limit per address sits in
 * front of it (the same shape as the payment request preview). The token is 256 random bits, so guessing one is not a real attack;
 * the limit is there so the page cannot be used as an oracle at volume either. Anything that cannot be read is { ok: false }, the
 * same answer as a token that does not exist.
 */
export async function loadInviteLanding(token: string): Promise<InviteLanding> {
  if (!isJoinToken(token)) return { ok: false };
  const ip = await getClientIp();
  const limited = await rateLimit(`circle:landing:${ip}`, { limit: 30, windowSeconds: 600 });
  if (!limited.success) return { ok: false, rate_limited: true };
  try {
    const { data, error } = await createServiceRoleClient().rpc("care_circle_invite_landing", { p_token: token });
    if (error) return { ok: false };
    return parseInviteLanding(data);
  } catch {
    return { ok: false };
  }
}
