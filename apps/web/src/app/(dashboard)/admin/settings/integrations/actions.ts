"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { API_KEY_SCOPES, generateApiKey } from "@/lib/integrations/api-key";
import type { TablesUpdate } from "@tarragon/shared";
import { callPartner } from "@/lib/integrations/partner-client";
import { randomBytes } from "crypto";

/**
 * Every action re-checks the integrations.manage gate itself (server
 * actions are directly callable endpoints — the page-level redirect is UX,
 * not security), and all table writes go through the caller's RLS-scoped
 * session: api_keys/partner_integrations RLS is what actually enforces
 * admin/delegated access.
 */
async function requireIntegrationsManager() {
  const profile = await getCurrentProfile();
  if (!profile?.organisation_id || !(await hasPermission("integrations.manage"))) {
    throw new Error("Not authorised");
  }
  return { ...profile, organisation_id: profile.organisation_id };
}

const createKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1),
  environment: z.enum(["sandbox", "live"]).default("live"),
});

export async function createApiKeyAction(input: {
  name: string;
  scopes: string[];
  environment?: "sandbox" | "live";
}): Promise<{ key: string } | { error: string }> {
  try {
    const profile = await requireIntegrationsManager();
    const parsed = createKeySchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const { key, keyPrefix, keyHash, environment } = generateApiKey(parsed.data.environment);
    const supabase = await createClient();
    const { error } = await supabase.from("api_keys").insert({
      organisation_id: profile.organisation_id,
      name: parsed.data.name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes: parsed.data.scopes,
      environment,
      created_by: profile.id,
    });
    if (error) return { error: error.message };

    revalidatePath("/admin/settings/integrations");
    // The one and only time the full key exists outside the partner's hands.
    return { key };
  } catch {
    return { error: "Not authorised" };
  }
}

export async function revokeApiKeyAction(keyId: string): Promise<{ error?: string }> {
  try {
    await requireIntegrationsManager();
    const supabase = await createClient();
    const { error } = await supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId)
      .is("revoked_at", null);
    if (error) return { error: error.message };
    revalidatePath("/admin/settings/integrations");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}

const partnerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  base_url: z.string().trim().url("Base URL must be a valid https:// URL").max(500),
  auth_header: z.string().trim().min(1).max(80),
  secret: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function savePartnerIntegrationAction(input: {
  id?: string;
  name: string;
  base_url: string;
  auth_header: string;
  secret?: string;
  notes?: string;
}): Promise<{ error?: string }> {
  try {
    const profile = await requireIntegrationsManager();
    const parsed = partnerSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const supabase = await createClient();
    if (input.id) {
      const update: TablesUpdate<"partner_integrations"> = {
        name: parsed.data.name,
        base_url: parsed.data.base_url,
        auth_header: parsed.data.auth_header,
        notes: parsed.data.notes ?? null,
        updated_at: new Date().toISOString(),
      };
      // An empty secret field on edit means "keep the stored secret".
      if (parsed.data.secret) update.secret = parsed.data.secret;
      const { error } = await supabase.from("partner_integrations").update(update).eq("id", input.id);
      if (error) return { error: error.message };
    } else {
      const { error } = await supabase.from("partner_integrations").insert({
        organisation_id: profile.organisation_id,
        name: parsed.data.name,
        base_url: parsed.data.base_url,
        auth_header: parsed.data.auth_header,
        secret: parsed.data.secret ?? null,
        notes: parsed.data.notes ?? null,
      });
      if (error) return { error: error.message };
    }
    revalidatePath("/admin/settings/integrations");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}

export async function setPartnerIntegrationActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  try {
    await requireIntegrationsManager();
    const supabase = await createClient();
    const { error } = await supabase
      .from("partner_integrations")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/settings/integrations");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}

export async function testPartnerConnectionAction(
  id: string
): Promise<{ ok: boolean; detail: string }> {
  try {
    await requireIntegrationsManager();
    const supabase = await createClient();
    const { data: integration } = await supabase
      .from("partner_integrations")
      .select("base_url, auth_header, secret, is_active")
      .eq("id", id)
      .maybeSingle();
    if (!integration) return { ok: false, detail: "Integration not found" };

    const result = await callPartner(integration, "/");
    const ok = result.ok;
    await supabase
      .from("partner_integrations")
      .update({ last_checked_at: new Date().toISOString(), last_check_ok: ok })
      .eq("id", id);
    revalidatePath("/admin/settings/integrations");
    return ok
      ? { ok: true, detail: `Reachable: HTTP ${result.status}` }
      : { ok: false, detail: result.error };
  } catch {
    return { ok: false, detail: "Not authorised" };
  }
}

// ---------------------------------------------------------------------------
// Partner webhook endpoints (§33.15). Same requireIntegrationsManager gate
// as everything above; partner_webhook_endpoints RLS (org-scoped,
// integrations.manage-gated) is what actually enforces it.
// ---------------------------------------------------------------------------

const EVENT_TYPES = [
  "result.available",
  "result.amended",
  "lab_order.created",
  "lab_order.cancelled",
  "appointment.booked",
  "appointment.cancelled",
  "appointment.rescheduled",
  "prescription.created",
  "prescription.cancelled",
  "dispense.completed",
  "patient.registered",
  "patient.consent_changed",
  "payment.settled",
  "payment.refunded",
  "claim.status_changed",
] as const;

const webhookEndpointSchema = z.object({
  id: z.string().uuid().optional(),
  partnerIntegrationId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  url: z.string().trim().url("URL must be a valid https:// URL"),
  eventTypes: z.array(z.enum(EVENT_TYPES)).min(1),
  environment: z.enum(["sandbox", "live"]).default("live"),
  description: z.string().trim().max(500).optional(),
});

/** 32 bytes hex — matches partner_webhook_endpoints_secret_strength's
 * length >= 32 CHECK with real margin. */
function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export async function saveWebhookEndpointAction(input: {
  id?: string;
  partnerIntegrationId: string;
  name: string;
  url: string;
  eventTypes: string[];
  environment?: "sandbox" | "live";
  description?: string;
}): Promise<{ secret?: string } | { error: string }> {
  try {
    const profile = await requireIntegrationsManager();
    const parsed = webhookEndpointSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const supabase = await createClient();
    if (parsed.data.id) {
      const { error } = await supabase
        .from("partner_webhook_endpoints")
        .update({
          name: parsed.data.name,
          url: parsed.data.url,
          event_types: parsed.data.eventTypes,
          environment: parsed.data.environment,
          description: parsed.data.description ?? null,
        })
        .eq("id", parsed.data.id);
      if (error) return { error: error.message };
      revalidatePath("/admin/settings/integrations");
      return {};
    }

    // A brand-new endpoint gets a freshly generated secret, shown once —
    // same "shown only at issue time" discipline as an API key.
    const secret = generateWebhookSecret();
    const { error } = await supabase.from("partner_webhook_endpoints").insert({
      organisation_id: profile.organisation_id,
      partner_integration_id: parsed.data.partnerIntegrationId,
      name: parsed.data.name,
      url: parsed.data.url,
      secret,
      event_types: parsed.data.eventTypes,
      environment: parsed.data.environment,
      description: parsed.data.description ?? null,
    });
    if (error) return { error: error.message };
    revalidatePath("/admin/settings/integrations");
    return { secret };
  } catch {
    return { error: "Not authorised" };
  }
}

export async function setWebhookEndpointActiveAction(id: string, isActive: boolean): Promise<{ error?: string }> {
  try {
    await requireIntegrationsManager();
    const supabase = await createClient();
    const { error } = await supabase.from("partner_webhook_endpoints").update({ is_active: isActive }).eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/settings/integrations");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}

export async function deleteWebhookEndpointAction(id: string): Promise<{ error?: string }> {
  try {
    await requireIntegrationsManager();
    const supabase = await createClient();
    const { error } = await supabase.from("partner_webhook_endpoints").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/admin/settings/integrations");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}

// ---------------------------------------------------------------------------
// Dead-letter queue recovery (§33.11). Both RPCs are SECURITY DEFINER and
// re-check organisation_id + integrations.manage internally (see the
// integration_outbound_queue_and_webhooks migration) — this action layer's
// requireIntegrationsManager call is belt-and-braces, same discipline as
// every other action in this file.
// ---------------------------------------------------------------------------

export async function requeueIntegrationEventAction(id: string): Promise<{ error?: string }> {
  try {
    await requireIntegrationsManager();
    const supabase = await createClient();
    const { error } = await supabase.rpc("requeue_integration_event", { p_outbound_event_id: id });
    if (error) return { error: error.message };
    revalidatePath("/admin/settings/integrations");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}

export async function cancelIntegrationEventAction(id: string): Promise<{ error?: string }> {
  try {
    await requireIntegrationsManager();
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_integration_event", { p_outbound_event_id: id });
    if (error) return { error: error.message };
    revalidatePath("/admin/settings/integrations");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}
