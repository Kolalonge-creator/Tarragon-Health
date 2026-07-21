import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { IntegrationsManager } from "./integrations-manager";

export default async function IntegrationsSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("integrations.manage"))) redirect("/admin");

  const supabase = await createClient();
  const [{ data: apiKeys }, { data: partners }] = await Promise.all([
    supabase
      .from("api_keys")
      .select("id, name, key_prefix, scopes, created_at, last_used_at, revoked_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("partner_integrations")
      .select("id, name, base_url, auth_header, notes, is_active, last_checked_at, last_check_ok, secret")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Integrations</h1>
        <p className="text-charcoal-ink/60">
          Inbound API keys let device clouds and partner platforms push data into
          TarragonHealth (see docs/INTEGRATIONS_API.md for the partner-facing spec).
          Outbound connections register partner APIs this platform calls.
        </p>
      </div>
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
      />
    </div>
  );
}
