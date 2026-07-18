import { createClient } from "@/lib/supabase/server";

/**
 * Null-gated feature gate — same pattern as ReviewedByDoctor/YourCareTeam:
 * renders `children` only once `public.has_feature_access(feature)` (see
 * 20260712201523_generalized_feature_access.sql) confirms the signed-in
 * patient's active/trialing subscription plan or attached add-on grants
 * `feature`, `fallback` (default nothing) otherwise. Never hardcodes a
 * gate's outcome — always asks the DB, so a lapsed/cancelled subscription
 * loses access on the very next render, not on some cached client state.
 *
 * Most call sites should pass an `UpgradePrompt` as `fallback` rather than
 * leaving it null — pricing.ts promises patients an upsell nudge ("we'll
 * encourage you to see a doctor and show you how to upgrade"), not silent
 * hiding of a section they might not know exists.
 */
export async function RequiresEntitlement({
  feature,
  children,
  fallback = null,
}: {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_feature_access", { feature });

  if (error || !data) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
