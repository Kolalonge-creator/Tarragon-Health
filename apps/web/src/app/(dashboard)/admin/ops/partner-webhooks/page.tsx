import { redirect } from "next/navigation";
import { Constants, DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { PageHeader } from "@/components/ui/page-header";
import { loadSubscriberStatus } from "@/lib/event-bus/load";
import { loadEndpoints, loadMappings } from "@/lib/partner-admin/load";
import { processorState } from "@/lib/partner-admin/model";
import { EndpointActions } from "./endpoint-actions";
import { MappingEditor } from "./mapping-editor";

export const metadata = { title: "Partner webhooks" };
export const dynamic = "force-dynamic";

const locale = DEFAULT_UI_LANGUAGE;
const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : t("busops.never", locale);
const cell = "px-3 py-2 align-top text-left text-sm text-charcoal-ink";
const head = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60";

/**
 * S10y: partner webhook endpoints and the partner event map. Admin only. The reads are admin-only database functions that never
 * return a signing key; a rotated key appears once, in the browser, and nowhere in this page's output.
 */
export default async function PartnerWebhooksPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const [endpoints, mappings, subs] = await Promise.all([loadEndpoints(), loadMappings(), loadSubscriberStatus()]);
  const processor = processorState(subs.rows, subs.failed);
  const partnerEventTypes = Constants.public.Enums.integration_event_type;

  return (
    <div className="space-y-6">
      <PageHeader title={t("partnerops.title", locale)} description={t("partnerops.intro", locale)} />

      {processor !== "ok" && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-charcoal-ink">
          {t(processor === "unreadable" ? "partnerops.banner.unreadable" : processor === "never" ? "partnerops.banner.never" : processor === "partner_stuck" ? "partnerops.banner.partner_stuck" : "partnerops.banner.stalled", locale)}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("partnerops.endpoints.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {endpoints.failed ? (
            <LoadFailure>{t("partnerops.load_failed", locale)}</LoadFailure>
          ) : endpoints.rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{t("partnerops.endpoints.empty", locale)}</p>
          ) : (
            <table className="w-full min-w-[900px]">
              <thead>
                <tr>
                  {(["endpoint", "state", "success", "failure", "queue", "key"] as const).map((c) => (
                    <th key={c} className={head}>{t(`partnerops.endpoints.col.${c}` as const, locale)}</th>
                  ))}
                  <th className={head} />
                </tr>
              </thead>
              <tbody>
                {endpoints.rows.map((e) => (
                  <tr key={e.endpoint_id} className="border-t border-charcoal-ink/10">
                    <td className={cell}>
                      <div className="font-medium">{e.name}</div>
                      <div className="text-xs text-charcoal-ink/60">{e.partner_name} ({e.environment})</div>
                      <div className="break-all text-xs text-charcoal-ink/60">{e.url}</div>
                      <div className="text-xs text-charcoal-ink/60">{e.event_types.join(", ")}</div>
                    </td>
                    <td className={cell}>
                      <Badge variant={e.is_active ? "green" : e.auto_disabled_at ? "red" : "grey"}>
                        {t(e.is_active ? "partnerops.endpoints.state.active" : e.auto_disabled_at ? "partnerops.endpoints.state.off_auto" : "partnerops.endpoints.state.off_manual", locale)}
                      </Badge>
                      {e.disabled_reason && <div className="mt-1 max-w-[220px] break-words text-xs">{e.disabled_reason}</div>}
                      {e.consecutive_failures > 0 && <div className="mt-1 text-xs">{t("partnerops.endpoints.failures", locale, { count: e.consecutive_failures })}</div>}
                      {e.auto_disabled_at && <div className="mt-1 text-xs text-charcoal-ink/60">{lagos(e.auto_disabled_at)}</div>}
                    </td>
                    <td className={cell}>{lagos(e.last_success_at)}</td>
                    <td className={cell}>{lagos(e.last_failure_at)}</td>
                    <td className={`${cell} text-xs`}>{t("partnerops.endpoints.queue", locale, { queued: Number(e.queued), dead: Number(e.dead), done: Number(e.delivered_24h) })}</td>
                    <td className={`${cell} text-xs`}>
                      {t("partnerops.endpoints.key_version", locale, { n: e.signing_key_version })}
                      {e.previous_key_expires_at && <div>{t("partnerops.endpoints.key_grace", locale, { when: lagos(e.previous_key_expires_at) })}</div>}
                    </td>
                    <td className={cell}>
                      <EndpointActions endpointId={e.endpoint_id} isActive={e.is_active} rotationLocked={Boolean(e.previous_key_expires_at)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("partnerops.map.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <p className="text-sm text-charcoal-ink/80">{t("partnerops.map.intro", locale)}</p>
          {mappings.failed ? (
            <LoadFailure>{t("partnerops.load_failed", locale)}</LoadFailure>
          ) : mappings.rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{t("partnerops.map.empty", locale)}</p>
          ) : (
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  {(["event", "partner", "ids", "state"] as const).map((c) => (
                    <th key={c} className={head}>{t(`partnerops.map.col.${c}` as const, locale)}</th>
                  ))}
                  <th className={head} />
                </tr>
              </thead>
              <tbody>
                {mappings.rows.map((m) => (
                  <tr key={m.bus_event_type} className="border-t border-charcoal-ink/10">
                    <td className={cell}>{m.bus_event_type}</td>
                    <td className={cell}>{m.integration_event_type ?? ""}</td>
                    <td className={`${cell} break-all text-xs`}>{m.id_keys.join(", ")}</td>
                    <td className={cell}>
                      <Badge variant={!m.is_mapped ? "grey" : m.subscriber_active ? "green" : "amber"}>
                        {t(!m.is_mapped ? "partnerops.map.unmapped" : m.subscriber_active ? "partnerops.map.mapped" : "partnerops.map.mapped_off", locale)}
                      </Badge>
                    </td>
                    <td className={cell}>
                      <MappingEditor
                        busEventType={m.bus_event_type}
                        isMapped={m.is_mapped}
                        partnerEventType={m.integration_event_type}
                        idKeys={m.id_keys}
                        partnerEventTypes={partnerEventTypes}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
