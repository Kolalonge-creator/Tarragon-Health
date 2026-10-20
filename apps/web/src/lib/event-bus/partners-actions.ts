"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loadPartnerEndpoints, loadPartnerMappings } from "./partners-load";
import { mappingSchema, reenableSchema, removeMappingSchema, rotateSchema, type PartnerActionState } from "./partners-model";

/**
 * Admin actions for the partner endpoint screen (S10y). Each one checks the role first, validates with Zod, then calls an
 * admin-only database function (which checks again and writes the audit row).
 *
 * Secret handling: rotatePartnerSecretAction is the only place a secret exists in application code. It is returned in the action result
 * to the one admin who asked and nowhere else: not logged, not put in an address or a redirect, not written to the audit log (the
 * database function never writes it). Errors are mapped to fixed sentences; the raw database error is dropped, so no message
 * text can carry anything back.
 */
const PATH = "/admin/ops/event-bus/partners";
const NOT_ADMIN: PartnerActionState = { status: "error", message: "busops.partners.error.not_admin" };
const INVALID: PartnerActionState = { status: "error", message: "busops.partners.error.invalid" };
const FAILED: PartnerActionState = { status: "error", message: "busops.partners.error.failed" };

async function isAdmin(): Promise<boolean> {
  return (await getCurrentProfile())?.role === "admin";
}

function formToObject(form: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(form.entries());
}

export async function rotatePartnerSecretAction(_prev: PartnerActionState, form: FormData): Promise<PartnerActionState> {
  if (!(await isAdmin())) return NOT_ADMIN;
  const parsed = rotateSchema.safeParse(formToObject(form));
  if (!parsed.success) return INVALID;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rotate_partner_webhook_secret", {
    p_endpoint_id: parsed.data.endpoint_id,
    p_grace_hours: parsed.data.grace_hours,
  });
  if (error) {
    if (error.code === "55000") return { status: "error", message: "busops.partners.rotate.in_grace", endpointId: parsed.data.endpoint_id };
    return error.code === "42501" ? NOT_ADMIN : FAILED;
  }
  if (typeof data !== "string" || data.length < 32) return FAILED;

  // The grace end comes from the list (which never returns a secret), so the panel can say when the old key stops working.
  // This read must never cost the admin the secret: it is guarded, and falls back to the requested window if it fails.
  let graceEndsAt: string | null = new Date(Date.now() + parsed.data.grace_hours * 3_600_000).toISOString();
  try {
    const list = await loadPartnerEndpoints();
    const fromDb = list.rows.find((r) => r.id === parsed.data.endpoint_id)?.previous_secret_expires_at;
    if (fromDb) graceEndsAt = fromDb;
  } catch {
    // keep the fallback
  }
  revalidatePath(PATH);
  return { status: "ok", endpointId: parsed.data.endpoint_id, secret: data, graceEndsAt };
}

export async function reenablePartnerEndpointAction(_prev: PartnerActionState, form: FormData): Promise<PartnerActionState> {
  if (!(await isAdmin())) return NOT_ADMIN;
  const parsed = reenableSchema.safeParse(formToObject(form));
  if (!parsed.success) return INVALID;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reenable_partner_webhook_endpoint", {
    p_endpoint_id: parsed.data.endpoint_id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    if (error.code === "42501") return NOT_ADMIN;
    if (error.code === "55000") return { status: "error", message: "busops.partners.enable.already_on", endpointId: parsed.data.endpoint_id };
    return error.code === "22023" ? INVALID : FAILED;
  }
  revalidatePath(PATH);
  return { status: "ok", message: "busops.partners.enable.done", endpointId: parsed.data.endpoint_id };
}

export async function saveMappingAction(_prev: PartnerActionState, form: FormData): Promise<PartnerActionState> {
  if (!(await isAdmin())) return NOT_ADMIN;
  const parsed = mappingSchema.safeParse(formToObject(form));
  if (!parsed.success) return INVALID;

  // Saving over an existing mapping would silently change what live partners receive. To change one, remove it first (both steps are audited).
  const existing = await loadPartnerMappings();
  if (existing.failed) return FAILED;
  if (existing.rows.some((m) => m.mapped && m.event_type === parsed.data.bus_event_type)) {
    return { status: "error", message: "busops.partners.mappings.already_mapped" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_partner_event_mapping", {
    p_bus_event_type: parsed.data.bus_event_type,
    p_integration_event_type: parsed.data.integration_event_type,
    p_id_keys: parsed.data.id_keys,
  });
  if (error) return error.code === "42501" ? NOT_ADMIN : error.code === "22023" ? INVALID : FAILED;
  revalidatePath(PATH);
  return { status: "ok", message: "busops.partners.mappings.saved" };
}

export async function removeMappingAction(_prev: PartnerActionState, form: FormData): Promise<PartnerActionState> {
  if (!(await isAdmin())) return NOT_ADMIN;
  const parsed = removeMappingSchema.safeParse(formToObject(form));
  if (!parsed.success) return INVALID;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_disable_partner_event_mapping", { p_bus_event_type: parsed.data.bus_event_type });
  if (error) return error.code === "42501" ? NOT_ADMIN : FAILED;
  revalidatePath(PATH);
  return { status: "ok", message: "busops.partners.mappings.removed" };
}
