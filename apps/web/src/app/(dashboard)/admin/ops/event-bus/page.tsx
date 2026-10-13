import { redirect } from "next/navigation";
import Link from "next/link";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { PageHeader } from "@/components/ui/page-header";
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
const cell = "px-3 py-2 align-top text-left text-sm text-charcoal-ink";
const head = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60";
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
        <CardContent className="overflow-x-auto">
          {subs.failed ? (
            <LoadFailure>{t("busops.load_failed", locale)}</LoadFailure>
          ) : subs.rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{t("busops.subscribers.empty", locale)}</p>
          ) : (
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  {(["name", "event", "pending", "dead", "done", "oldest", "success", "failure"] as const).map((c) => (
                    <th key={c} className={head}>{t(`busops.subscribers.col.${c}` as const, locale)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subs.rows.map((r) => (
                  <tr key={r.subscriber_key} className="border-t border-charcoal-ink/10">
                    <td className={cell}>
                      <Link className="underline" href={`/admin/ops/event-bus${filtersToQuery({ subscriber: r.subscriber_key })}`}>{r.subscriber_key}</Link>
                      {!r.is_active && <Badge variant="grey" className="ml-2">{t("busops.subscribers.off", locale)}</Badge>}
                      {r.lag_incident_open && <Badge variant="red" className="ml-2">{t("busops.subscribers.lag_open", locale)}</Badge>}
                    </td>
                    <td className={cell}>{r.event_type}</td>
                    <td className={cell}>{Number(r.pending) + Number(r.processing)}</td>
                    <td className={cell}>{r.dead}</td>
                    <td className={cell}>{r.done_24h}</td>
                    <td className={cell}>{r.oldest_due_seconds > 0 ? formatAge(r.oldest_due_seconds, locale) : "-"}</td>
                    <td className={cell}>{lagos(r.last_success_at)}</td>
                    <td className={cell}>{lagos(r.last_failure_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        <CardContent className="overflow-x-auto">
          {deliveries.failed ? (
            <LoadFailure>{t("busops.load_failed", locale)}</LoadFailure>
          ) : deliveries.rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">{t("busops.deliveries.empty", locale)}</p>
          ) : (
            <table className="w-full min-w-[860px]">
              <thead>
                <tr>
                  {(["event", "ids", "subscriber", "status", "tries", "lag", "error"] as const).map((c) => (
                    <th key={c} className={head}>{t(`busops.deliveries.col.${c}` as const, locale)}</th>
                  ))}
                  <th className={head} />
                </tr>
              </thead>
              <tbody>
                {deliveries.rows.map((d) => {
                  const status = d.status as DeliveryStatus;
                  const detail = `/admin/ops/event-bus${filtersToQuery(filters)}${filtersToQuery(filters) ? "&" : "?"}open=${d.delivery_id}`;
                  return (
                    <tr key={d.delivery_id} className="border-t border-charcoal-ink/10">
                      <td className={cell}>
                        {d.event_type} v{d.event_version}
                        {d.priority === "urgent" && <Badge variant="red" className="ml-2">{t("busops.deliveries.urgent", locale)}</Badge>}
                        {d.is_test && <Badge variant="grey" className="ml-2">{t("busops.deliveries.test", locale)}</Badge>}
                      </td>
                      <td className={`${cell} break-all text-xs`}>{formatIds(d.payload_ids)}</td>
                      <td className={cell}>{d.subscriber_key}</td>
                      <td className={cell}><Badge variant={TONE[status] ?? "grey"}>{t(`busops.status.${status}` as const, locale)}</Badge></td>
                      <td className={cell}><Link className="underline" href={detail}>{d.attempt_count}</Link></td>
                      <td className={cell}>{formatAge(d.lag_seconds, locale)}</td>
                      <td className={`${cell} max-w-[260px] break-words text-xs`}>{d.last_error ?? ""}</td>
                      <td className={cell}>
                        {status === "dead" && (
                          <form action={replayDeliveryAction}>
                            <input type="hidden" name="delivery_id" value={d.delivery_id} />
                            <input type="hidden" name="status" value={filters.status ?? ""} />
                            <input type="hidden" name="subscriber" value={filters.subscriber ?? ""} />
                            <input type="hidden" name="type" value={filters.eventType ?? ""} />
                            <button type="submit" className="rounded-lg border border-charcoal-ink/20 px-3 py-1 text-xs font-semibold text-charcoal-ink">{t("busops.replay.button", locale)}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
