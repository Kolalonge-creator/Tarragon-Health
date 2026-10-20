import { redirect } from "next/navigation";
import Link from "next/link";
import { Constants, DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { PageHeader } from "@/components/ui/page-header";
import { MappingForm, ReenableForm, RemoveMappingForm, RotateKeyForm } from "@/components/event-bus/partner-forms";
import { loadPartnerEndpoints, loadPartnerMappings } from "@/lib/event-bus/partners-load";

export const metadata = { title: "Partner endpoints" };
export const dynamic = "force-dynamic";

const locale = DEFAULT_UI_LANGUAGE;
const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : t("busops.never", locale);
const head = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60";
const cell = "px-3 py-2 align-top text-left text-sm text-charcoal-ink";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-charcoal-ink">{children}</dd>
    </div>
  );
}

/**
 * S10y: partner endpoints for admins. Status, key rotation with a copy-once secret, switching a disabled endpoint back on with a
 * reason, and which bus events are mapped to partners. The reads never return a secret; the writes are audited database functions.
 */
export default async function PartnerEndpointsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const [endpoints, mappings] = await Promise.all([loadPartnerEndpoints(), loadPartnerMappings()]);
  const mapped = mappings.rows.filter((m) => m.mapped);
  const eventOptions = mappings.rows.map((m) => ({ value: m.event_type, label: m.event_type }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("busops.partners.title", locale)} description={t("busops.partners.intro", locale)} />
      <p>
        <Link href="/admin/ops/event-bus" className="text-sm underline">{t("busops.partners.back", locale)}</Link>
      </p>

      <Card>
        <CardHeader>
          <CardTitle>{t("busops.partners.endpoints.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {endpoints.failed ? (
            <LoadFailure>{t("busops.partners.load_failed", locale)}</LoadFailure>
          ) : endpoints.rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{t("busops.partners.endpoints.empty", locale)}</p>
          ) : (
            endpoints.rows.map((e) => (
              <section key={e.id} aria-labelledby={`ep-${e.id}`} className="space-y-4 rounded-lg border border-charcoal-ink/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={`ep-${e.id}`} className="text-base font-semibold text-charcoal-ink">{e.name}</h3>
                  <Badge variant={e.is_active ? "green" : "red"}>{t(e.is_active ? "busops.partners.on" : "busops.partners.off", locale)}</Badge>
                  {e.auto_disabled_at && <Badge variant="amber">{t("busops.partners.auto_off", locale)}</Badge>}
                </div>
                <dl className="grid gap-3 sm:grid-cols-3">
                  <Fact label={t("busops.partners.field.host", locale)}>{e.url_host}</Fact>
                  <Fact label={t("busops.partners.field.environment", locale)}>{e.environment}</Fact>
                  <Fact label={t("busops.partners.field.key_version", locale)}>{e.signing_key_version}</Fact>
                  <Fact label={t("busops.partners.field.last_success", locale)}>{lagos(e.last_success_at)}</Fact>
                  <Fact label={t("busops.partners.field.last_failure", locale)}>{lagos(e.last_failure_at)}</Fact>
                  <Fact label={t("busops.partners.field.failures", locale)}>{e.consecutive_failures}</Fact>
                  <Fact label={t("busops.partners.field.queued", locale)}>{e.queued_events}</Fact>
                  <Fact label={t("busops.partners.field.events", locale)}>{e.event_types.join(", ")}</Fact>
                  {e.previous_secret_expires_at && <Fact label={t("busops.partners.field.grace", locale)}>{lagos(e.previous_secret_expires_at)}</Fact>}
                  {e.auto_disabled_at && <Fact label={t("busops.partners.field.disabled_at", locale)}>{lagos(e.auto_disabled_at)}</Fact>}
                  {e.disabled_reason && <Fact label={t("busops.partners.field.reason", locale)}>{e.disabled_reason}</Fact>}
                </dl>
                <RotateKeyForm endpointId={e.id} inGrace={Boolean(e.previous_secret_expires_at)} locale={locale} />
                {!e.is_active && <ReenableForm endpointId={e.id} locale={locale} />}
              </section>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("busops.partners.mappings.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-charcoal-ink/70">{t("busops.partners.mappings.intro", locale)}</p>
          {mappings.failed ? (
            <LoadFailure>{t("busops.partners.load_failed", locale)}</LoadFailure>
          ) : (
            <>
              {mapped.length === 0 ? (
                <p className="text-sm text-charcoal-ink/60">{t("busops.partners.mappings.none", locale)}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr>
                        {(["event", "partner", "ids", "state"] as const).map((c) => (
                          <th key={c} scope="col" className={head}>{t(`busops.partners.mappings.col.${c}` as const, locale)}</th>
                        ))}
                        <th scope="col" className={head} />
                      </tr>
                    </thead>
                    <tbody>
                      {mapped.map((m) => (
                        <tr key={m.event_type} className="border-t border-charcoal-ink/10">
                          <td className={cell}>
                            {m.event_type}
                            {m.is_urgent && <Badge variant="red" className="ml-2">{t("busops.partners.mappings.urgent", locale)}</Badge>}
                          </td>
                          <td className={cell}>{m.integration_event_type}</td>
                          <td className={`${cell} break-all text-xs`}>{m.id_keys.join(", ") || "-"}</td>
                          <td className={cell}><Badge variant={m.subscriber_active ? "green" : "grey"}>{t(m.subscriber_active ? "busops.partners.on" : "busops.partners.off", locale)}</Badge></td>
                          <td className={cell}><RemoveMappingForm eventType={m.event_type} locale={locale} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <MappingForm eventOptions={eventOptions} partnerOptions={[...Constants.public.Enums.integration_event_type]} locale={locale} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
