import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { VerifiedApiKey } from "@/lib/integrations/api-key";

export interface QuotaCheckResult {
  allowed: boolean;
  used?: number;
  limit?: number | null;
}

/**
 * Enforces protocol_api_licenses.calls_included_per_month, admin-provisioned
 * flat monthly tiers (20260901181314_protocol_api_licenses.sql) — a hard
 * cap, not a soft degrade, so overage is visible for manual invoicing per
 * the founder's chosen scope. A partner with no license row at all (every
 * partner set up before this existed, or one on the 'unlimited' tier) is
 * always allowed — this only ever restricts a partner an admin has
 * explicitly capped. Queried directly against the table via the service
 * role rather than an RPC: protocol_api_licenses has no RLS policy at all
 * (admin RPCs only), but a direct table read under service_role bypasses
 * RLS the same way logProtocolApiUsage's insert already does.
 */
export async function checkProtocolApiQuota(verified: VerifiedApiKey): Promise<QuotaCheckResult> {
  const supabase = createServiceRoleClient();

  const { data: license } = await supabase
    .from("protocol_api_licenses")
    .select("calls_included_per_month")
    .eq("organisation_id", verified.organisationId)
    .eq("is_active", true)
    .maybeSingle();

  if (!license || license.calls_included_per_month == null) {
    return { allowed: true };
  }

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("protocol_api_usage_log")
    .select("*", { count: "exact", head: true })
    .eq("organisation_id", verified.organisationId)
    .gte("called_at", startOfMonth.toISOString());

  const used = count ?? 0;
  return { allowed: used < license.calls_included_per_month, used, limit: license.calls_included_per_month };
}
