import { createClient } from "@/lib/supabase/server";
import { SerologyRulesView } from "../health-report-config/sign-view";

/** The serology rules sign-off panel (HIV, hepatitis B and C repeat rules and the anti-HBs threshold). Shared by the CMO's page and the sign-off hub. */
export async function SerologyRulesPanel({ canSign = true }: { canSign?: boolean }) {
  const { data, error } = await (await createClient())
    .from("serology_rule_versions")
    .select("id, version, code, config, notes, threshold_approved_by")
    .eq("status", "active")
    .maybeSingle();
  if (error) return <p role="alert" className="text-sm text-red-700">The serology rules could not be loaded. Please refresh.</p>;
  return (
    <SerologyRulesView
      rule={data ? { id: data.id, version: data.version, code: data.code, config: data.config, notes: data.notes } : null}
      thresholdSigned={Boolean(data?.threshold_approved_by)}
      canSign={canSign}
    />
  );
}
