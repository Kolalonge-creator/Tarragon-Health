"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { isBusEventType, isIntegrationEventType, parseIdKeys, type PartnerResult } from "./partner-model";

/**
 * Admin actions for the partner webhook screens (S10x follow-up). Each one only checks the role first for a clear answer; the database
 * functions are the real gate and write the audit row (ids and key versions only, never a secret).
 *
 * Nothing here creates a mapping or switches an endpoint on by itself: a person presses the button, and re-enable is refused for an endpoint
 * the platform did not switch off. The rotation result carries the new signing key in the response of THIS call only: it is never put in an
 * address, never revalidated into a cached page and never stored by this app.
 */
const PATH = "/admin/ops/event-bus/partners";
const idSchema = z.string().uuid();

function back(result: PartnerResult): never {
  redirect(`${PATH}?r=${result}`);
}

async function isAdmin(): Promise<boolean> {
  return (await getCurrentProfile())?.role === "admin";
}

export type RotateState = { status: "idle" } | { status: "rotated"; secret: string } | { status: "failed" | "window_open" | "invalid" | "forbidden" };

export async function rotateKeyAction(_prev: RotateState, form: FormData): Promise<RotateState> {
  if (!(await isAdmin())) return { status: "forbidden" };
  const id = idSchema.safeParse(form.get("endpoint_id"));
  const hours = z.coerce.number().int().min(1).max(168).safeParse(form.get("grace_hours"));
  if (!id.success || !hours.success) return { status: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rotate_partner_webhook_secret", { p_endpoint_id: id.data, p_grace_hours: hours.data });
  // 55000: the previous rotation is still in its grace window (a leaked key cannot be replaced until it ends).
  if (error?.code === "55000") return { status: "window_open" };
  if (error || typeof data !== "string" || data.length < 32) return { status: "failed" };
  return { status: "rotated", secret: data };
}

export async function reenableEndpointAction(form: FormData): Promise<void> {
  if (!(await isAdmin())) return back("failed");
  const id = idSchema.safeParse(form.get("endpoint_id"));
  if (!id.success) return back("invalid");

  const supabase = await createClient();
  // Only an endpoint the platform switched off by itself can be brought back here; a hand-made switch-off stays with the integrations page.
  const { data: endpoint, error: readError } = await supabase
    .from("partner_webhook_endpoints")
    .select("is_active, auto_disabled_at")
    .eq("id", id.data)
    .maybeSingle();
  if (readError || !endpoint || endpoint.is_active || !endpoint.auto_disabled_at) return back("failed");

  const { error } = await supabase.rpc("reenable_partner_webhook_endpoint", { p_endpoint_id: id.data });
  revalidatePath(PATH);
  return back(error ? "failed" : "reenabled");
}

export async function setMappingAction(form: FormData): Promise<void> {
  if (!(await isAdmin())) return back("failed");
  const busType = form.get("bus_event_type");
  const integrationType = form.get("integration_event_type");
  const keys = parseIdKeys(form.get("id_keys"));
  // The admin must tick the box: a mapping sends ids to an outside party, which needs the DPO and CMO view of consent first.
  if (form.get("confirm") !== "yes" || !isBusEventType(busType) || !isIntegrationEventType(integrationType) || !keys.ok) return back("invalid");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_partner_event_mapping", {
    p_bus_event_type: busType,
    p_integration_event_type: integrationType,
    p_id_keys: keys.keys,
  });
  revalidatePath(PATH);
  return back(error ? "failed" : "mapped");
}

export async function removeMappingAction(form: FormData): Promise<void> {
  if (!(await isAdmin())) return back("failed");
  const busType = form.get("bus_event_type");
  if (!isBusEventType(busType)) return back("invalid");

  const supabase = await createClient();
  // The database function removes the mapping and switches its subscriber off when the integration type is null (its typed signature has no null).
  const { error } = await supabase.rpc("set_partner_event_mapping", {
    p_bus_event_type: busType,
    p_integration_event_type: null as never,
  });
  revalidatePath(PATH);
  return back(error ? "failed" : "unmapped");
}
