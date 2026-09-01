"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { generateApiKey } from "@/lib/integrations/api-key";

/**
 * Every action re-checks integrations.manage itself, same discipline as
 * admin/settings/integrations/actions.ts -- the page-level redirect is UX,
 * not security. The real gate is inside each SECURITY DEFINER RPC
 * (protocol_api_usage_log migration, 20260802205424); this is a second,
 * belt-and-braces check so a non-permitted caller gets a clean early
 * return instead of relying solely on the RPC's own exception.
 */
async function requireIntegrationsManager() {
  const profile = await getCurrentProfile();
  if (!profile || !(await hasPermission("integrations.manage"))) {
    throw new Error("Not authorised");
  }
  return profile;
}

const createPartnerSchema = z.object({ name: z.string().trim().min(2).max(120) });

export async function createProtocolPartnerAction(name: string): Promise<{ error?: string }> {
  try {
    await requireIntegrationsManager();
    const parsed = createPartnerSchema.safeParse({ name });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_create_protocol_partner_org", {
      p_name: parsed.data.name,
    });
    if (error) return { error: error.message };

    revalidatePath("/admin/settings/protocol-api");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}

const issueKeySchema = z.object({
  organisationId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
});

export async function issueProtocolApiKeyAction(input: {
  organisationId: string;
  name: string;
}): Promise<{ key: string } | { error: string }> {
  try {
    await requireIntegrationsManager();
    const parsed = issueKeySchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const { key, keyPrefix, keyHash } = generateApiKey();
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_issue_protocol_api_key", {
      p_organisation_id: parsed.data.organisationId,
      p_name: parsed.data.name,
      p_key_prefix: keyPrefix,
      p_key_hash: keyHash,
    });
    if (error) return { error: error.message };

    revalidatePath("/admin/settings/protocol-api");
    // The one and only time the full key exists outside the partner's hands.
    return { key };
  } catch {
    return { error: "Not authorised" };
  }
}

export async function revokeProtocolApiKeyAction(keyId: string): Promise<{ error?: string }> {
  try {
    await requireIntegrationsManager();
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_revoke_protocol_api_key", { p_key_id: keyId });
    if (error) return { error: error.message };
    revalidatePath("/admin/settings/protocol-api");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}

const setLicenseSchema = z.object({
  organisationId: z.string().uuid(),
  tier: z.enum(["up_to_10k", "up_to_50k", "unlimited"]),
  monthlyPriceKobo: z.number().int().min(0),
  callsIncludedPerMonth: z.number().int().positive().nullable(),
});

export async function setProtocolApiLicenseAction(input: {
  organisationId: string;
  tier: "up_to_10k" | "up_to_50k" | "unlimited";
  monthlyPriceKobo: number;
  callsIncludedPerMonth: number | null;
}): Promise<{ error?: string }> {
  try {
    await requireIntegrationsManager();
    const parsed = setLicenseSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_set_protocol_api_license", {
      p_organisation_id: parsed.data.organisationId,
      p_tier: parsed.data.tier,
      p_monthly_price_kobo: parsed.data.monthlyPriceKobo,
      p_calls_included_per_month: parsed.data.callsIncludedPerMonth,
    });
    if (error) return { error: error.message };

    revalidatePath("/admin/settings/protocol-api");
    return {};
  } catch {
    return { error: "Not authorised" };
  }
}

export async function listProtocolApiKeysAction(
  organisationId: string
): Promise<
  | {
      keys: {
        id: string;
        name: string;
        key_prefix: string;
        created_at: string;
        last_used_at: string | null;
        revoked_at: string | null;
      }[];
    }
  | { error: string }
> {
  try {
    await requireIntegrationsManager();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_list_protocol_api_keys", {
      p_organisation_id: organisationId,
    });
    if (error) return { error: error.message };
    return { keys: data ?? [] };
  } catch {
    return { error: "Not authorised" };
  }
}
