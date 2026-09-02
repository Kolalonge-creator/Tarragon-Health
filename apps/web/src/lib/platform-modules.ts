import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * The two platform-sized modules built ahead of the business that will use
 * them — see `public.platform_modules`
 * (20260829092227_platform_module_activation_gate.sql) and CLAUDE.md's
 * "build it fully but keep it dormant" instruction for modules 27/28.
 *
 * This is a UI convenience only. The real gate is in the database: every
 * payer/provider-org table's RLS policies and every write RPC call
 * `private.assert_module_enabled`/`private.module_enabled` independently —
 * a bug in this file cannot leak data, at worst it mis-renders a page that
 * the database would refuse anyway. Keep it that way: never use the result
 * of `isPlatformModuleEnabled` as the ONLY check before a write.
 */
export type PlatformModuleKey = "payer_platform" | "provider_org_platform";

export type PlatformModuleRow = {
  key: string;
  label: string;
  description: string;
  is_enabled: boolean;
  enabled_at: string | null;
  activation_note: string | null;
};

/** Every module row — used by the superadmin activation console. */
export async function listPlatformModules(): Promise<PlatformModuleRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_modules")
    .select("key, label, description, is_enabled, enabled_at, activation_note")
    .order("key");
  return data ?? [];
}

/** Whether one named module is currently switched on. */
export async function isPlatformModuleEnabled(key: PlatformModuleKey): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_modules")
    .select("is_enabled")
    .eq("key", key)
    .maybeSingle();
  return data?.is_enabled ?? false;
}
