import { redirect } from "next/navigation";
import Link from "next/link";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";
import { replayDeliveryAction } from "@/lib/event-bus/actions";
import { loadAttempts, loadDeliveries, loadSubscriberStatus, PAGE_SIZE } from "@/lib/event-bus/load";
import { DELIVERY_STATUSES, filtersToQuery, formatAge, formatIds, parseFilters, type DeliveryStatus } from "@/lib/event-bus/model";
import { EventBusTile } from "@/components/event-bus/event-bus-tile";

export const metadata = { title: "Event bus" };
export const dynamic = "force-dynamic";

const locale = DEFAULT_UI_LANGUAGE;
const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : t("busops.never", locale);
const TONE: Record<DeliveryStatus, "green" | "amber" | "red" | "blue"> = { done: "green", pending: "amber", processing: "blue", dead: "red" };
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink";

/**
 * S10x: the event bus explorer. Delivery history with attempts, lag, dead letters and replay, plus the heartbeat of each subscriber.
 * Admin only: every read is an admin-only database function that returns ids and routing facts, never a reading, a name or a
 * patient id. Replay uses the audited replay function.
 */
export default async function EventBusPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; subscriber?: string; type?: string; before?: string; beforeId?: string; open?: string; r?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const [subs, deliveries] = await Promise.all([loadSubscriberStatus(), loadDeliveries(filters)]);
  const openId = typeof sp.open === "string" && /^[0-9a-f-]{36}$/.test(sp.open) ? sp.open : null;
  const attempts = openId ? await loadAttempts(openId) : null;
  const replay = sp.r === "ok" || sp.r === "failed" || sp.r === "busy" ? sp.r : null;
  const last = deliveries.rows[deliveries.rows.length - 1];
  const older = deliveries.rows.length === PAGE_SIZE && last ? filtersToQuery({ ...filters, before: last.created_at, beforeId: last.delivery_id }) : null;

  const subColumns: DataTableColumn[] = (["name", "event", "pending", "dead", "done", "oldest", "success", "failure"] as const).map((c) => ({
    header: t(`busops.subscribers.col.${c}` as const, locale),
    sortable: true,
    defaultDir: c === "name" || c === "event" ? "asc" : "desc",
    align: c === "pending" || c === "dead" || c === "done" ? "right" : undefined,
  }));
  const subRows: DataTableRow[] = subs.rows.map((r) => ({
    key: r.subscriber_key,
    searchText: `${r.subscriber_key} ${r.event_type}`,
    sort: [
      r.subscriber_key,
      r.event_type,
      Number(r.pending) + Number(r.processing),
      Number(r.dead),
      Number(r.done_24h),
      r.oldest_due_seconds > 0 ? r.oldest_due_seconds : null,
      r.last_success_at,
      r.last_failure_at,
    ],
    cells: [
      <span key="name">
        <Link className="underline" href={`/admin/ops/event-bus${filtersToQuery({ subscriber: r.subscriber_key })}`}>{r.subscriber_key}</Link>
        {!r.is_active && <Badge variant="grey" className="ml-2">{t("busops.subscribers.off", locale)}</Badge>}
        {r.lag_incident_open && <Badge variant="red" className="ml-2">{t("busops.subscribers.lag_open", locale)}</Badge>}
      </span>,
      r.event_type,
      Number(r.pending) + Number(r.processing),
      r.dead,
      r.done_24h,
      r.oldest_due_seconds > 0 ? formatAge(r.oldest_due_seconds, locale) : "-",
      lagos(r.last_success_at),
      lagos(r.last_failure_at),
    ],
  }));

  const deliveryColumns: DataTableColumn[] = [
    ...(["event", "ids", "subscriber", "status", "tries", "lag", "error"] as const).map((c) => ({
      header: t(`busops.deliveries.col.${c}` as const, locale),
      sortable: c !== "ids" && c !== "error",
      defaultDir: c === "tries" || c === "lag" ? ("desc" as const) : ("asc" as const),
      className: c === "ids" ? "break-all text-xs" : c === "error" ? "max-w-[260px] break-words text-xs" : undefined,
    })),
    { header: "Actions" },
  ];
  // Dead first when sorted by status: those are the ones to replay.
  const STATUS_ORDER: Record<DeliveryStatus, number> = { dead: 0, pending: 1, processing: 2, done: 3 };
  const deliveryRows: DataTableRow[] = deliveries.rows.map((d) => {
    const status = d.status as DeliveryStatus;
    const detail = `/admin/ops/event-bus${filtersToQuery(filters)}${filtersToQuery(filters) ? "&" : "?"}open=${d.delivery_id}`;
    return {
      key: d.delivery_id,
      sort: [d.event_type, null, d.subscriber_key, STATUS_ORDER[status] ?? null, d.attempt_count, d.lag_seconds, null, null],
      cells: [
        <span key="event">
          {d.event_type} v{d.event_version}
          {d.priority === "urgent" && <Badge variant="red" className="ml-2">{t("busops.deliveries.urgent", locale)}</Badge>}
          {d.is_test && <Badge variant="grey" className="ml-2">{t("busops.deliveries.test", locale)}</Badge>}
        </span>,
        formatIds(d.payload_ids),
        d.subscriber_key,
        <Badge key="status" variant={TONE[status] ?? "grey"}>{t(`busops.status.${status}` as const, locale)}</Badge>,
        <Link key="tries" className="underline" href={detail}>{d.attempt_count}</Link>,
        formatAge(d.lag_seconds, locale),
        d.last_error ?? "",
        status === "dead" ? (
          <form key="replay" action={replayDeliveryAction}>
            <input type="hidden" name="delivery_id" value={d.delivery_id} />
            <input type="hidden" name="status" value={filters.status ?? ""} />
            <input type="hidden" name="subscriber" value={filters.subscriber ?? ""} />
            <input type="hidden" name="type" value={filters.eventType ?? ""} />
            <button type="submit" className="rounded-lg border border-charcoal-ink/20 px-3 py-1 text-xs font-semibold text-charcoal-ink">{t("busops.replay.button", locale)}</button>
          </form>
        ) : null,
      ],
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("busops.title", locale)} description={t("busops.intro", locale)} />

      {replay && (
        <p role="status" className={`rounded-lg border px-4 py-3 text-sm ${replay === "ok" ? "border-brand-green/40 bg-brand-green/5" : "border-red-300 bg-red-50"}`}>
          {t(replay === "ok" ? "busops.replay.ok" : replay === "busy" ? "busops.replay.busy" : "busops.replay.failed", locale)}
        </p>
      )}

      <EventBusTile locale={locale} />

      <Card>
        <CardHeader>
          <CardTitle>{t("busops.subscribers.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          {subs.failed ? (
            <LoadFailure>{t("busops.load_failed", locale)}</LoadFailure>
          ) : (
            <DataTable
              caption={t("busops.subscribers.title", locale)}
              columns={subColumns}
              rows={subRows}
              searchLabel="Search subscribers"
              emptyMessage={t("busops.subscribers.empty", locale)}
              noun={{ one: "subscriber", many: "subscribers" }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("busops.filter.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm">
              {t("busops.filter.status", locale)}
              <select name="status" defaultValue={filters.status ?? ""} className={field}>
                <option value="">{t("busops.filter.any", locale)}</option>
                {DELIVERY_STATUSES.map((s) => (
                  <option key={s} value={s}>{t(`busops.status.${s}` as const, locale)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {t("busops.filter.subscriber", locale)}
              <input name="subscriber" defaultValue={filters.subscriber ?? ""} className={field} maxLength={120} />
            </label>
            <label className="text-sm">
              {t("busops.filter.event", locale)}
              <input name="type" defaultValue={filters.eventType ?? ""} className={field} maxLength={120} />
            </label>
            <div className="flex items-end">
              <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">{t("busops.filter.apply", locale)}</button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("busops.deliveries.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent>
          {deliveries.failed ? (
            <LoadFailure>{t("busops.load_failed", locale)}</LoadFailure>
          ) : (
            // The database hands these over a page at a time (the "older" link below), newest first. The table only sorts
            // the page in hand, never pages it again, and its count says so; filtering is the form above, run in the query.
            <DataTable
              caption={t("busops.deliveries.title", locale)}
              columns={deliveryColumns}
              rows={deliveryRows}
              pageSize={Math.max(PAGE_SIZE, deliveryRows.length)}
              emptyMessage={t("busops.deliveries.empty", locale)}
              noun={{ one: "delivery on this page", many: "deliveries on this page" }}
            />
          )}
          {older && (
            <p className="mt-3">
              <Link className="text-sm underline" href={`/admin/ops/event-bus${older}`}>{t("busops.deliveries.more", locale)}</Link>
            </p>
          )}
        </CardContent>
      </Card>

      {attempts && (
        <Card>
          <CardHeader>
            <CardTitle>{t("busops.attempts.title", locale)}</CardTitle>
          </CardHeader>
          <CardContent>
            {attempts.failed ? (
              <LoadFailure>{t("busops.load_failed", locale)}</LoadFailure>
            ) : attempts.rows.length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">{t("busops.attempts.empty", locale)}</p>
            ) : (
              <ul className="space-y-1 text-sm text-charcoal-ink">
                {attempts.rows.map((a) => (
                  <li key={`${a.attempt_no}-${a.created_at}`}>
                    {a.attempt_no}. {t(`busops.attempts.outcome.${a.outcome as "done" | "retry" | "dead"}` as const, locale)}, {lagos(a.created_at)}
                    {a.error ? `: ${a.error}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
