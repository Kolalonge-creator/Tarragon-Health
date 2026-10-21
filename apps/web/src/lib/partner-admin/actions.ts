"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Constants } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { errorWord, parseIdKeys, type ActionError } from "./model";

/**
 * Partner webhook admin actions (S10y). Admin only, checked here for a clear answer and again inside every database function.
 * Each result is a fixed shape: either a success or one of a few fixed error words. The raw database error is never returned,
 * and nothing in this file logs: a rotated signing key passes through memory once, on its way back to the admin's screen.
 */
const PATH = "/admin/ops/partner-webhooks";
const uuid = z.string().uuid();
const BUS_KEY = /^[a-z][a-z0-9_.]{0,119}$/;

/** Rotation cannot be undone and the key is shown once, so an unclear failure is reported as such (see RotateOutcome use). */
export type Outcome = { ok: true } | { ok: false; error: ActionError };
export type RotateOutcome = { ok: true; secret: string } | { ok: false; error: ActionError };

async function requireAdmin(): Promise<boolean> {
  return (await getCurrentProfile())?.role === "admin";
}

export async function rotateSecretAction(endpointId: string, graceHours: number): Promise<RotateOutcome> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const id = uuid.safeParse(endpointId);
  const grace = z.number().int().min(1).max(168).safeParse(graceHours);
  if (!id.success || !grace.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rotate_partner_webhook_secret", { p_endpoint_id: id.data, p_grace_hours: grace.data });
  // No revalidatePath here on purpose: a re-render that fails to load the table would unmount the screen holding the only copy of
  // the new key. The screen refreshes itself once the admin confirms they have copied it.
  if (error || typeof data !== "string" || data.length < 32) return { ok: false, error: errorWord(error?.code) };
  return { ok: true, secret: data };
}

export async function reenableEndpointAction(endpointId: string, reason: string): Promise<Outcome> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const id = uuid.safeParse(endpointId);
  const why = z.string().trim().min(10).max(500).safeParse(reason);
  if (!id.success) return { ok: false, error: "invalid" };
  if (!why.success) return { ok: false, error: "reason" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reenable_partner_webhook_endpoint", { p_endpoint_id: id.data, p_reason: why.data });
  revalidatePath(PATH);
  return error ? { ok: false, error: errorWord(error.code, "reason") } : { ok: true };
}

export async function saveMappingAction(busEventType: string, partnerEventType: string, idKeys: string): Promise<Outcome> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const bus = z.string().regex(BUS_KEY).safeParse(busEventType);
  const partner = z.enum(Constants.public.Enums.integration_event_type).safeParse(partnerEventType);
  const keys = parseIdKeys(idKeys);
  if (!bus.success || !partner.success || "error" in keys) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_partner_event_mapping", {
    p_bus_event_type: bus.data,
    p_integration_event_type: partner.data,
    p_id_keys: keys.keys,
  });
  revalidatePath(PATH);
  return error ? { ok: false, error: errorWord(error.code, "mapping") } : { ok: true };
}

export async function removeMappingAction(busEventType: string): Promise<Outcome> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const bus = z.string().regex(BUS_KEY).safeParse(busEventType);
  if (!bus.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_partner_event_mapping", { p_bus_event_type: bus.data });
  revalidatePath(PATH);
  return error ? { ok: false, error: errorWord(error.code, "mapping") } : { ok: true };
}
