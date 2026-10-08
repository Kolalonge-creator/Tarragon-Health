import { createClient } from "@supabase/supabase-js";
import { Constants, getProposedConfig } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

/**
 * "Set up for my parent", the parent's confirmation, ending it, and the hand-over at 18, on the phone (v5 1.18, 1.19, S42).
 * Everything goes through the same database functions as the web; nothing here decides who can see what.
 *
 * The proxy never sees the parent's record before the parent confirms with a code on their own phone (safety case 23). The
 * parent can always see who set it up and end it in one tap (OQ-48). A young person finishes their own hand-over at 18.
 */
export const CARE_ACCESS_CATEGORIES = Constants.public.Enums.care_access_category;
export type CareAccessCategory = (typeof CARE_ACCESS_CATEGORIES)[number];

export interface PendingProxySetup {
  id: string;
  requesterFirstName: string;
  expiresAt: string;
}

export interface ProxyArrangement {
  grantId: string;
  setUpBy: string;
  since: string | null;
  categories: string[];
}

export interface HandoverState {
  pending: boolean;
  guardians: { id: string; firstName: string }[];
}

type ProxySetupConfig = { ttlHours: number; maxPerDay: number };

/** Starts a setup, then asks Auth to text a code to the PARENT's number from a stateless client (never this session). */
export async function startProxySetup(fullName: string, phoneE164: string): Promise<QueryResult<{ hours: number }>> {
  const config = getProposedConfig<ProxySetupConfig>("proxy.setup").value;
  const { error } = await supabase.rpc("create_proxy_setup", {
    p_full_name: fullName,
    p_phone: phoneE164,
    p_ttl_hours: config.ttlHours,
    p_max_per_day: config.maxPerDay,
  });
  if (error) {
    if (error.message.includes("proxy_setup_rate_limited")) return { ok: false, error: t("proxy.setup.error.rate_limited") };
    if (error.message.includes("your own number")) return { ok: false, error: t("proxy.setup.error.own_number") };
    if (error.message.includes("proxy_setup_cooling_off")) return { ok: false, error: t("proxy.setup.error.cooling_off") };
    return { ok: false, error: t("proxy.setup.error.invalid") };
  }
  const sender = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: otpError } = await sender.auth.signInWithOtp({ phone: phoneE164, options: { shouldCreateUser: true } });
  // Never report success when no code went out: the proxy would wait for a parent who has nothing to enter.
  if (otpError) return { ok: false, error: t("proxy.setup.error.not_sent") };
  return { ok: true, data: { hours: config.ttlHours } };
}

export async function loadPendingProxySetups(): Promise<QueryResult<PendingProxySetup[]>> {
  const { data, error } = await supabase.rpc("my_pending_proxy_setups");
  if (error) return { ok: false, error: error.message };
  const rows = (Array.isArray(data) ? data : []) as unknown as Array<{ id: string; requester_first_name: string; expires_at: string }>;
  return { ok: true, data: rows.map((r) => ({ id: r.id, requesterFirstName: r.requester_first_name, expiresAt: r.expires_at })) };
}

/** The parent's answer. Only the categories they tick are shared; none ticked shares nothing. */
export async function confirmProxySetup(setupId: string, categories: CareAccessCategory[]): Promise<QueryResult<null>> {
  const safe = categories.filter((c) => (CARE_ACCESS_CATEGORIES as readonly string[]).includes(c));
  const { error } = await supabase.rpc("confirm_proxy_setup", { p_setup_id: setupId, p_categories: safe, p_permissions: [] });
  return error ? { ok: false, error: t("proxy.confirm.error") } : { ok: true, data: null };
}

export async function declineProxySetup(setupId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("decline_proxy_setup", { p_setup_id: setupId });
  return error ? { ok: false, error: t("proxy.confirm.error") } : { ok: true, data: null };
}

export async function loadProxyArrangements(): Promise<ProxyArrangement[]> {
  const { data, error } = await supabase.rpc("my_proxy_arrangements");
  if (error || !Array.isArray(data)) return [];
  return (data as unknown as Array<{ grant_id: string; set_up_by: string; since: string | null; categories: string[] }>).map((a) => ({
    grantId: a.grant_id,
    setUpBy: a.set_up_by,
    since: a.since,
    categories: a.categories ?? [],
  }));
}

export async function endProxyAccess(grantId: string): Promise<QueryResult<null>> {
  const days = getProposedConfig<{ days: number }>("proxy.cooling_off").value.days;
  const { error } = await supabase.rpc("end_proxy_access", { p_grant: grantId, p_block_days: days });
  return error ? { ok: false, error: t("proxy.arrangement.error") } : { ok: true, data: null };
}

export async function loadMyHandover(): Promise<HandoverState> {
  const { data, error } = await supabase.rpc("my_handover");
  if (error || typeof data !== "object" || data === null) return { pending: false, guardians: [] };
  const raw = data as { pending?: boolean; guardians?: Array<{ id: string; first_name: string }> };
  return { pending: raw.pending === true, guardians: (raw.guardians ?? []).map((g) => ({ id: g.id, firstName: g.first_name })) };
}

export async function completeHandover(keep: string[]): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("complete_dependant_handover", { p_keep: keep });
  return error ? { ok: false, error: t("handover.error") } : { ok: true, data: null };
}
