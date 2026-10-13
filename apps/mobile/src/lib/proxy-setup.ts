/**
 * "Set up for my parent" on the phone (S04b-1, v5 8.2, function 1.19, safety case 23). Same rules as
 * apps/web/src/app/(dashboard)/patient/family/proxy-setup-actions.ts:
 *
 *  - the setup is recorded with the TTL and daily cap from versioned config, never from the form;
 *  - the verification code goes to the PARENT's number only, through a stateless client that never touches the proxy's
 *    own session, and with shouldCreateUser false: starting a setup never creates an account for a number nobody has
 *    verified (OQ-52). A number with no account is answered exactly like one with an account;
 *  - the proxy sees nothing about the parent until the parent, signed in on their own phone, chooses what to share
 *    (confirm_proxy_setup). This module grants nothing itself.
 *
 * Pure logic with injected calls so every branch is testable without a device or a network. Nothing here logs: a phone
 * number or a name must never reach console, Sentry or analytics.
 */
import { getProposedConfig } from "@tarragon/shared";
import type { MessageKey } from "@tarragon/i18n";
import { isRateLimited, isUnknownUserOtpError } from "@/lib/auth/auth-flow";

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
export type RpcCall = (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
export type CodeSender = (phone: string) => PromiseLike<{ error: { message: string; code?: string } | null }>;

type ProxySetupConfig = { ttlHours: number; maxPerDay: number };

export type StartProxyOutcome =
  | { kind: "sent"; hours: number }
  | { kind: "error"; key: MessageKey };

export async function startProxySetup(
  deps: { rpc: RpcCall; sendCode: CodeSender },
  args: { fullName: string; phone: string },
): Promise<StartProxyOutcome> {
  const name = args.fullName.trim();
  if (name.length < 1 || name.length > 200) return { kind: "error", key: "proxy.setup.error.invalid" };
  if (!/^\+[1-9][0-9]{7,14}$/.test(args.phone)) return { kind: "error", key: "proxy.setup.error.invalid" };

  const config = getProposedConfig<ProxySetupConfig>("proxy.setup").value;
  const created = await deps.rpc("create_proxy_setup", {
    p_full_name: name,
    p_phone: args.phone,
    p_ttl_hours: config.ttlHours,
    p_max_per_day: config.maxPerDay,
  });
  if (created.error) {
    if (created.error.message.includes("proxy_setup_rate_limited")) return { kind: "error", key: "proxy.setup.error.rate_limited" };
    if (created.error.message.includes("your own number")) return { kind: "error", key: "proxy.setup.error.own_number" };
    return { kind: "error", key: "proxy.setup.error.invalid" };
  }

  const sent = await deps.sendCode(args.phone);
  // A number with no account, or a code already on its way, looks exactly like success: the screen cannot be used to
  // learn which numbers are registered. Any other failure is reported, because the parent would be waiting for nothing.
  if (sent.error && !isUnknownUserOtpError(sent.error.message) && !isRateLimited(sent.error.message)) {
    return { kind: "error", key: "proxy.setup.error.not_sent" };
  }
  return { kind: "sent", hours: config.ttlHours };
}

export interface PendingProxySetup {
  id: string;
  requester_first_name: string;
  expires_at: string;
}

/** What the parent sees after signing in on their own phone: a first name and an expiry, nothing else. */
export async function loadPendingProxySetups(rpc: RpcCall): Promise<PendingProxySetup[] | null> {
  const result = await rpc("my_pending_proxy_setups");
  if (result.error || !Array.isArray(result.data)) return null;
  return result.data as PendingProxySetup[];
}

/** The parent's answer. Only the setup id and categories from the fixed list are sent; identity comes from the session. */
export async function answerProxySetup(
  rpc: RpcCall,
  args: { setupId: string; categories: string[]; accept: boolean },
): Promise<boolean> {
  const result = args.accept
    ? await rpc("confirm_proxy_setup", { p_setup_id: args.setupId, p_categories: args.categories, p_permissions: [] })
    : await rpc("decline_proxy_setup", { p_setup_id: args.setupId });
  return !result.error;
}
