import { supabase } from "./supabase";

/**
 * Privacy-PIN gate for the Sexual & Reproductive Health hub (spec §47.2).
 * Mirrors apps/web/src/lib/queries/sexual-health-privacy.ts. A shared-device
 * privacy screen, not a security boundary — the data behind it stays fully
 * RLS-protected regardless. pin_hash has no client-facing SELECT grant
 * (column-level); a row existing at all IS "a PIN is set," since
 * clear_sexual_health_pin deletes the row entirely rather than nulling the
 * hash.
 */

export interface SexualHealthPrivacyStatus {
  hasPin: boolean;
  lockedUntil: string | null;
}

export async function loadSexualHealthPrivacyStatus(): Promise<SexualHealthPrivacyStatus> {
  const { data, error } = await supabase.from("sexual_health_privacy_settings").select("failed_attempts, locked_until").maybeSingle();
  if (error) throw error;
  return { hasPin: !!data, lockedUntil: data?.locked_until ?? null };
}

export function isCurrentlyLocked(lockedUntil: string | null): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > Date.now();
}

export async function setSexualHealthPin(pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("set_sexual_health_pin", { p_pin: pin });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function clearSexualHealthPin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("clear_sexual_health_pin");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Returns true/false for a right/wrong guess; the caller should treat a
 * thrown error with code '55006' as the lockout state specifically (a
 * countdown, not a retry button) — see verify_sexual_health_pin's own doc
 * comment. */
export async function verifySexualHealthPin(pin: string): Promise<{ ok: true; correct: boolean } | { ok: false; locked: boolean; error: string }> {
  const { data, error } = await supabase.rpc("verify_sexual_health_pin", { p_pin: pin });
  if (error) {
    const locked = (error as { code?: string }).code === "55006";
    return { ok: false, locked, error: error.message };
  }
  return { ok: true, correct: data === true };
}
