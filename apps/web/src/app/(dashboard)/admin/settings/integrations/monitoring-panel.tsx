"use client";

import { useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cancelIntegrationEventAction, requeueIntegrationEventAction } from "./actions";

/**
 * §33.8 catalogue + §33.9 monitoring + §33.11 dead-letter recovery, in one
 * panel above the key/connection management below it — an admin opens this
 * page to answer "is everything connected and healthy", not to manage
 * credentials first.
 */

interface CatalogueRow {
  partner_integration_id: string;
  name: string;
  base_url: string;
  is_active: boolean;
  has_inbound_key: boolean;
  inbound_key_last_used_at: string | null;
  outbound_last_checked_at: string | null;
  outbound_last_check_ok: boolean | null;
  webhook_endpoint_count: number;
  webhook_active_endpoint_count: number;
  webhook_last_success_at: string | null;
  webhook_last_failure_at: string | null;
  webhook_max_consecutive_failures: number;
  status: string;
  last_activity_at: string | null;
}

interface HealthMetrics {
  window_hours: number;
  total_requests: number;
  ok_requests: number;
  failed_requests: number;
  authentication_failures: number;
  data_mismatches: number;
  rate_limited_requests: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  outbound_delivered: number;
  outbound_pending: number;
  outbound_failed_retrying: number;
  outbound_dead_letter: number;
  outbound_overdue: number;
  outbound_delayed_deliveries: number;
}

interface DeadLetteredRow {
  id: string;
  event_type: string;
  webhook_endpoint_id: string;
  webhook_endpoint_name: string;
  attempt_count: number;
  last_status_code: number | null;
  last_error: string | null;
  created_at: string;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "never";
}

function statusBadge(status: string) {
  if (status === "connected") return <Badge variant="green">Connected</Badge>;
  if (status === "error") return <Badge variant="red">Connection error</Badge>;
  if (status === "disabled") return <Badge variant="grey">Disabled</Badge>;
  return <Badge variant="amber">Not yet connected</Badge>;
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-charcoal-ink/10 p-3">
      <p className="text-xs text-charcoal-ink/50">{label}</p>
      <p className="text-lg font-semibold text-charcoal-ink">{value}</p>
    </div>
  );
}

export function IntegrationMonitoringPanel({
  catalogue,
  health,
  deadLettered,
}: {
  catalogue: CatalogueRow[];
  health: HealthMetrics | null;
  deadLettered: DeadLetteredRow[];
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Integration catalogue</CardTitle>
        </CardHeader>
        <CardContent>
          {catalogue.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              No partner connections registered yet. Add one below.
            </p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {catalogue.map((row) => (
                <li key={row.partner_integration_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {row.name} {statusBadge(row.status)}
                    </p>
                    <p className="truncate text-xs text-charcoal-ink/50">
                      {row.base_url} · {row.webhook_active_endpoint_count}/{row.webhook_endpoint_count} webhook
                      endpoints active · last activity {formatDate(row.last_activity_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Health: last {health?.window_hours ?? 24}h</CardTitle>
        </CardHeader>
        <CardContent>
          {!health || health.total_requests === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No inbound API calls in this window yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricTile label="Requests" value={health.total_requests} />
              <MetricTile label="Failed" value={health.failed_requests} />
              <MetricTile label="Auth failures" value={health.authentication_failures} />
              <MetricTile label="Rate limited" value={health.rate_limited_requests} />
              <MetricTile label="Avg latency" value={health.avg_latency_ms ? `${health.avg_latency_ms}ms` : "—"} />
              <MetricTile label="p95 latency" value={health.p95_latency_ms ? `${health.p95_latency_ms}ms` : "—"} />
              <MetricTile label="Data mismatches" value={health.data_mismatches} />
              <MetricTile label="Webhook queue overdue" value={health.outbound_overdue} />
            </div>
          )}
          {health && (health.outbound_delivered > 0 || health.outbound_dead_letter > 0 || health.outbound_pending > 0) && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricTile label="Webhooks delivered" value={health.outbound_delivered} />
              <MetricTile label="Webhooks pending" value={health.outbound_pending} />
              <MetricTile label="Webhooks retrying" value={health.outbound_failed_retrying} />
              <MetricTile label="Dead-lettered" value={health.outbound_dead_letter} />
            </div>
          )}
        </CardContent>
      </Card>

      {deadLettered.length > 0 && <DeadLetterQueueSection rows={deadLettered} />}
    </div>
  );
}

function DeadLetterQueueSection({ rows }: { rows: DeadLetteredRow[] }) {
  const [pending, startTransition] = useTransition();

  function handleRequeue(id: string) {
    startTransition(async () => {
      await requeueIntegrationEventAction(id);
    });
  }

  function handleCancel(id: string) {
    startTransition(async () => {
      await cancelIntegrationEventAction(id);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Dead-lettered webhook deliveries <Badge variant="red">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/60">
          Every retry (§33.11) was exhausted for these events. Fix the partner-side cause,
          then requeue. A requeued event gets a fresh attempt count and retries from the
          start of the backoff ladder.
        </p>
        <ul className="divide-y divide-charcoal-ink/10">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-charcoal-ink">
                  {row.event_type} → {row.webhook_endpoint_name}
                </p>
                <p className="truncate text-xs text-charcoal-ink/50">
                  {row.attempt_count} attempts · last status {row.last_status_code ?? "—"} ·{" "}
                  {row.last_error ?? "no error recorded"} · queued {formatDate(row.created_at)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={() => handleRequeue(row.id)}>
                  Requeue
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => handleCancel(row.id)}>
                  Cancel
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
