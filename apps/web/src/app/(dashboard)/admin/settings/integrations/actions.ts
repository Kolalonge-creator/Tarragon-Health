"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { API_KEY_SCOPES, generateApiKey } from "@/lib/integrations/api-key";
import type { TablesUpdate } from "@tarragon/shared";
import { callPartner } from "@/lib/integrations/partner-client";

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
});

export async function createApiKeyAction(input: {
  name: string;
  scopes: string[];
}): Promise<{ key: string } | { error: string }> {
  try {
    const profile = await requireIntegrationsManager();
    const parsed = createKeySchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const { key, keyPrefix, keyHash } = generateApiKey();
    const supabase = await createClient();
    const { error } = await supabase.from("api_keys").insert({
      organisation_id: profile.organisation_id,
      name: parsed.data.name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes: parsed.data.scopes,
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
      ? { ok: true, detail: `Reachable — HTTP ${result.status}` }
      : { ok: false, detail: result.error };
  } catch {
    return { ok: false, detail: "Not authorised" };
  }
}
