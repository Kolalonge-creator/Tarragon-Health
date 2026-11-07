import { redirect } from "next/navigation";
import { Constants, DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";
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

  const endpointColumns: DataTableColumn[] = [
    ...(["endpoint", "state", "success", "failure", "queue", "key"] as const).map((c) => ({
      header: t(`partnerops.endpoints.col.${c}` as const, locale),
      sortable: c !== "queue" && c !== "key",
      defaultDir: c === "success" || c === "failure" ? ("desc" as const) : ("asc" as const),
      className: c === "endpoint" ? "min-w-56" : c === "queue" || c === "key" ? "text-xs" : undefined,
    })),
    { header: "Actions" },
  ];
  const endpointRows: DataTableRow[] = endpoints.rows.map((e) => {
    // Sorting by state puts switched-off endpoints first: the ones needing attention.
    const state = e.is_active ? 2 : e.auto_disabled_at ? 0 : 1;
    return {
      key: e.endpoint_id,
      searchText: `${e.name} ${e.partner_name} ${e.environment} ${e.url} ${e.event_types.join(" ")}`,
      sort: [e.name, state, e.last_success_at, e.last_failure_at, null, null, null],
      cells: [
        <div key="ep">
          <div className="font-medium">{e.name}</div>
          <div className="text-xs text-charcoal-ink/60">{e.partner_name} ({e.environment})</div>
          <div className="break-all text-xs text-charcoal-ink/60">{e.url}</div>
          <div className="text-xs text-charcoal-ink/60">{e.event_types.join(", ")}</div>
        </div>,
        <div key="state">
          <Badge variant={e.is_active ? "green" : e.auto_disabled_at ? "red" : "grey"}>
            {t(e.is_active ? "partnerops.endpoints.state.active" : e.auto_disabled_at ? "partnerops.endpoints.state.off_auto" : "partnerops.endpoints.state.off_manual", locale)}
          </Badge>
          {e.disabled_reason && <div className="mt-1 max-w-[220px] break-words text-xs">{e.disabled_reason}</div>}
          {e.consecutive_failures > 0 && <div className="mt-1 text-xs">{t("partnerops.endpoints.failures", locale, { count: e.consecutive_failures })}</div>}
          {e.auto_disabled_at && <div className="mt-1 text-xs text-charcoal-ink/60">{lagos(e.auto_disabled_at)}</div>}
        </div>,
        lagos(e.last_success_at),
        lagos(e.last_failure_at),
        t("partnerops.endpoints.queue", locale, { queued: Number(e.queued), dead: Number(e.dead), done: Number(e.delivered_24h) }),
        <div key="key">
          {t("partnerops.endpoints.key_version", locale, { n: e.signing_key_version })}
          {e.previous_key_expires_at && <div>{t("partnerops.endpoints.key_grace", locale, { when: lagos(e.previous_key_expires_at) })}</div>}
        </div>,
        <EndpointActions key="act" endpointId={e.endpoint_id} isActive={e.is_active} rotationLocked={Boolean(e.previous_key_expires_at)} />,
      ],
    };
  });

  const mapColumns: DataTableColumn[] = [
    ...(["event", "partner", "ids", "state"] as const).map((c) => ({
      header: t(`partnerops.map.col.${c}` as const, locale),
      sortable: c !== "ids",
      className: c === "ids" ? "break-all text-xs" : undefined,
    })),
    { header: "Actions" },
  ];
  const mapRows: DataTableRow[] = mappings.rows.map((m) => ({
    key: m.bus_event_type,
    searchText: `${m.bus_event_type} ${m.integration_event_type ?? ""} ${m.id_keys.join(" ")}`,
    sort: [m.bus_event_type, m.integration_event_type, null, !m.is_mapped ? 0 : m.subscriber_active ? 2 : 1, null],
    cells: [
      m.bus_event_type,
      m.integration_event_type ?? "",
      m.id_keys.join(", "),
      <Badge key="state" variant={!m.is_mapped ? "grey" : m.subscriber_active ? "green" : "amber"}>
        {t(!m.is_mapped ? "partnerops.map.unmapped" : m.subscriber_active ? "partnerops.map.mapped" : "partnerops.map.mapped_off", locale)}
      </Badge>,
      <MappingEditor
        key="edit"
        busEventType={m.bus_event_type}
        isMapped={m.is_mapped}
        partnerEventType={m.integration_event_type}
        idKeys={m.id_keys}
        partnerEventTypes={partnerEventTypes}
      />,
    ],
  }));

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
        <CardContent>
          {endpoints.failed ? (
            <LoadFailure>{t("partnerops.load_failed", locale)}</LoadFailure>
          ) : (
            <DataTable
              caption={t("partnerops.endpoints.title", locale)}
              columns={endpointColumns}
              rows={endpointRows}
              searchLabel="Search endpoints"
              emptyMessage={t("partnerops.endpoints.empty", locale)}
              noun={{ one: "endpoint", many: "endpoints" }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("partnerops.map.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-charcoal-ink/80">{t("partnerops.map.intro", locale)}</p>
          {mappings.failed ? (
            <LoadFailure>{t("partnerops.load_failed", locale)}</LoadFailure>
          ) : (
            <DataTable
              caption={t("partnerops.map.title", locale)}
              columns={mapColumns}
              rows={mapRows}
              searchLabel="Search events"
              emptyMessage={t("partnerops.map.empty", locale)}
              noun={{ one: "event", many: "events" }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
