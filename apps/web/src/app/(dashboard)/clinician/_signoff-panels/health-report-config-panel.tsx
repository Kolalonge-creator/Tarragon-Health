import { createClient } from "@/lib/supabase/server";
import { HealthReportConfigView, type ConfigVersionRow } from "../health-report-config/sign-view";

/**
 * The yearly Health Report settings sign-off panel: loads its own data and renders the real values with the Sign control. Shared by the CMO's own page and
 * the sign-off hub (which opens it inline, so a signature is never given unseen). Access is gated by the page that renders it.
 */
export async function HealthReportConfigPanel({ canSign = true }: { canSign?: boolean }) {
  const { data, error } = await (await createClient())
    .from("health_report_config_versions")
    .select("id, version, is_active, approved_at, notes, config")
    .order("version", { ascending: false });
  if (error || !data) return <p role="alert" className="text-sm text-red-700">The report settings could not be loaded. Please refresh.</p>;
  const rows = data as ConfigVersionRow[];
  const live = rows.find((r) => r.is_active) ?? null;
  // only a draft NEWER than the live version is offered; an older one is history and signing it would put the platform back
  const draft = rows.find((r) => !r.approved_at && r.version > (live?.version ?? 0)) ?? null;
  return <HealthReportConfigView live={live} draft={draft} canSign={canSign} />;
}
