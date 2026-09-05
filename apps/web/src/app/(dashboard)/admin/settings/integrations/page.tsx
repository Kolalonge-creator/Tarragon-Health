import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { IntegrationsManager } from "./integrations-manager";
import { IntegrationMonitoringPanel } from "./monitoring-panel";

export default async function IntegrationsSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("integrations.manage"))) redirect("/admin");

  const supabase = await createClient();
  const [
    { data: apiKeys },
    { data: partners },
    { data: webhookEndpoints },
    { data: catalogue },
    { data: health },
    { data: deadLettered },
  ] = await Promise.all([
    supabase
      .from("api_keys")
      .select("id, name, key_prefix, scopes, environment, rate_limit_per_minute, created_at, last_used_at, revoked_at, expires_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("partner_integrations")
      .select("id, name, base_url, auth_header, notes, is_active, last_checked_at, last_check_ok, secret")
      .order("created_at", { ascending: false }),
    supabase
      .from("partner_webhook_endpoints")
      .select(
        "id, partner_integration_id, name, url, event_types, environment, is_active, last_success_at, last_failure_at, consecutive_failures, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase.rpc("integration_catalogue"),
    supabase.rpc("integration_health_metrics", { p_window_hours: 24 }),
    supabase
      .from("integration_outbound_events")
      .select("id, event_type, webhook_endpoint_id, attempt_count, last_status_code, last_error, created_at")
      .eq("status", "dead_letter")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Inbound API keys let device clouds and partner platforms push data into TarragonHealth (see docs/INTEGRATIONS_API.md for the partner-facing spec). Outbound connections register partner APIs this platform calls, and webhook endpoints receive events (a result becoming available, an appointment being cancelled) as they happen."
      />
      <IntegrationMonitoringPanel
        catalogue={catalogue ?? []}
        health={health?.[0] ?? null}
        deadLettered={(deadLettered ?? []).map((row) => ({
          ...row,
          webhook_endpoint_name:
            (webhookEndpoints ?? []).find((w) => w.id === row.webhook_endpoint_id)?.name ?? "(deleted endpoint)",
        }))}
      />
      <IntegrationsManager
        apiKeys={(apiKeys ?? []).map((k) => ({ ...k }))}
        partners={(partners ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          base_url: p.base_url,
          auth_header: p.auth_header,
          notes: p.notes,
          is_active: p.is_active,
          last_checked_at: p.last_checked_at,
          last_check_ok: p.last_check_ok,
          has_secret: Boolean(p.secret),
        }))}
        webhookEndpoints={(webhookEndpoints ?? []).map((w) => ({ ...w }))}
      />
    </div>
  );
}
