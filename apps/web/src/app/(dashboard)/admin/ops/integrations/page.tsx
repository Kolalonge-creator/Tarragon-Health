import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { checkDependencies, providerKeysPresent } from "@/lib/status/check-dependencies";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HEALTH_LABEL, healthLine, type HealthState } from "@/lib/admin-overview/model";
import { PROVIDERS, providerLine, statusSchema, type ProviderDef } from "@/lib/integrations-centre/model";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

const HEALTH_BADGE: Record<HealthState, "green" | "amber" | "red" | "grey"> = {
  operational: "green",
  degraded: "amber",
  failed: "red",
  unknown: "grey",
  not_configured: "grey",
};

const lagos = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const CATEGORY_ORDER: ProviderDef["category"][] = ["Payments", "Communication", "Appointments and video", "AI", "Location", "Infrastructure"];

/**
 * The integrations centre (docs/design/SUPERADMIN-CONSOLE.md, phase 2d): each platform provider, its state from what it
 * actually did in the last 7 days (public.admin_integration_status, admin only), whether its key is set, and where to
 * look deeper. Read-only: there is no "test connection" button, because no provider here has a probe that is both
 * safe and meaningful (a test charge moves money, a test email or SMS reaches a person). Secrets are never read.
 */
export default async function IntegrationsCentrePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const [statusRes, deps] = await Promise.all([supabase.rpc("admin_integration_status"), checkDependencies()]);
  const parsed = statusRes.error ? null : statusSchema.safeParse(statusRes.data);
  const status = parsed?.success ? parsed.data : null;

  // Presence of each provider's key, read in the status module; a value is never read here.
  const keys = providerKeysPresent();
  const lines = PROVIDERS.map((def) => {
    const activity = status && def.key !== "maps" ? status[def.key] : null;
    // Without the status read, a provider with a record of calls must not be judged on its key alone.
    const line = !status && def.key !== "maps"
      ? { state: "unknown" as const, evidence: "Its activity could not be loaded." }
      : providerLine(activity, keys[def.key], lagos);
    return { def, line, activity };
  });
  const database = healthLine(deps.supabase, lagos);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Every outside service the platform depends on, judged by what it actually did in the last 7 days. A key that is set is never, on its own, taken as proof that a provider works."
        actions={
          <p className="flex flex-wrap gap-4 text-sm">
            <Link className="underline" href="/admin/settings/integrations">Partner APIs and webhooks</Link>
            <Link className="underline" href="/admin/ops/providers">Payments, video and email events</Link>
          </p>
        }
      />

      {!status && (
        <LoadFailure>
          Provider activity could not be loaded, so every provider below shows as Unknown rather than as working. Reload to try again.
        </LoadFailure>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Database (Supabase)</CardTitle>
          <CardDescription>Checked live when this page loaded.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-charcoal-ink/70">{database.evidence}</span>
          <Badge variant={HEALTH_BADGE[database.state]}>{HEALTH_LABEL[database.state]}</Badge>
        </CardContent>
      </Card>

      {CATEGORY_ORDER.map((category) => {
        const inCategory = lines.filter((l) => l.def.category === category);
        if (inCategory.length === 0) return null;
        return (
          <section key={category} aria-labelledby={`cat-${category}`} className="space-y-3">
            <h2 id={`cat-${category}`} className="font-heading text-lg font-semibold text-charcoal-ink">
              {category}
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {inCategory.map(({ def, line, activity }) => (
                <Card key={def.key}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle>{def.name}</CardTitle>
                        <CardDescription>{def.role}</CardDescription>
                      </div>
                      <Badge variant={HEALTH_BADGE[line.state]}>{HEALTH_LABEL[line.state]}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="text-charcoal-ink/80">{line.evidence}</p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-charcoal-ink/70">
                      <dt>Key set</dt>
                      <dd>{keys[def.key] ? "Yes" : "No"}</dd>
                      {activity?.last_failed_at ? (
                        <>
                          <dt>Last failure</dt>
                          <dd>{lagos(activity.last_failed_at)}</dd>
                        </>
                      ) : null}
                      {activity && activity.webhooks_ok_7d !== undefined ? (
                        <>
                          <dt>Webhooks, 7 days</dt>
                          <dd>
                            {activity.webhooks_ok_7d} processed, {activity.webhooks_bad_7d ?? 0} rejected or failed
                          </dd>
                          <dt>Last webhook</dt>
                          <dd>{activity.last_webhook_at ? lagos(activity.last_webhook_at) : "None received"}</dd>
                        </>
                      ) : null}
                    </dl>
                    <p className="text-xs text-charcoal-ink/55">{def.measures}</p>
                    <Link href={def.detailHref} className="inline-block text-xs font-medium text-brand-green hover:underline">
                      Look deeper
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-charcoal-ink/55">
        {status ? `Activity counted from ${lagos(status.since)} to ${lagos(status.computed_at)} (Lagos). ` : ""}
        Test traffic is included on purpose: a test send still exercises the provider. Keys and secrets are changed in the
        hosting environment, never on this page.
      </p>
    </div>
  );
}
