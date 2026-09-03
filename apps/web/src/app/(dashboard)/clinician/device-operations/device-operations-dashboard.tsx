"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Radio, Timer } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, formatPercent } from "@/lib/analytics/format";
import {
  useDeviceDataQuality,
  useIntegrationHealth,
  useRpmSlaMetrics,
  type DeviceDataQualityRow,
} from "@/lib/queries/device-operations";
import { createClient } from "@/lib/supabase/client";
import { SectionCard, CenterNote, MiniBarList } from "@/app/(dashboard)/analytics/_components/primitives";

const HEALTH_BADGE: Record<string, BadgeProps["variant"]> = {
  operational: "green",
  degraded: "amber",
  delayed: "blue",
  down: "red",
};

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

export function DeviceOperationsDashboard({ organisationId }: { organisationId: string }) {
  const health = useIntegrationHealth();
  const quality = useDeviceDataQuality(organisationId);
  const sla = useRpmSlaMetrics(organisationId);
  const queryClient = useQueryClient();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const q = quality.data ?? [];
  const missingCount = q.filter((r) => r.is_missing_data).length;
  const errorCount = q.filter((r) => r.status === "error").length;
  const downComponents = (health.data?.status ?? []).filter((s) => s.state === "down").length;

  async function handleRevoke(row: DeviceDataQualityRow) {
    if (row.connection_kind !== "wearable") return;
    if (!window.confirm(`Revoke this ${row.provider_or_device_type} connection? The patient's stored access token will be cleared and they will need to reconnect.`)) {
      return;
    }
    setRevokingId(row.connection_id);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("revoke_wearable_connection", {
        p_connection_id: row.connection_id,
        p_reason: "Revoked from device operations dashboard",
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["device-operations", "data-quality", organisationId] });
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Device operations</h1>
        <p className="text-sm text-charcoal-ink/60">
          Connection fleet health — which patient has which device/connection, is it working, and are
          measurements arriving.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={AlertTriangle}
          label="Pipelines down"
          value={formatNumber(downComponents)}
          tintClassName={downComponents > 0 ? "bg-red-100" : undefined}
          iconClassName={downComponents > 0 ? "text-red-700" : undefined}
        />
        <StatTile icon={Radio} label="Connections/devices missing data" value={formatNumber(missingCount)} />
        <StatTile icon={AlertTriangle} label="Connections/devices in error" value={formatNumber(errorCount)} />
        <StatTile
          icon={Activity}
          label="Device reporting adherence"
          value={sla.data?.device_reporting_adherence_pct != null ? formatPercent(sla.data.device_reporting_adherence_pct) : "—"}
          unit="synced in last 3 days"
        />
      </div>

      <SectionCard title="Integration health" description="55.11 — one row per ingestion component.">
        {health.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {(health.data?.status ?? []).map((s) => (
                <div
                  key={s.component}
                  className="flex items-center justify-between rounded-lg border border-charcoal-ink/10 px-3 py-2"
                >
                  <span className="text-xs font-medium capitalize text-charcoal-ink/80">
                    {s.component.replace(/_/g, " ")}
                  </span>
                  <Badge variant={HEALTH_BADGE[s.state] ?? "grey"}>{s.state}</Badge>
                </div>
              ))}
            </div>
            {(health.data?.openIncidents.length ?? 0) > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="mb-2 text-xs font-semibold text-red-700">Open incidents</p>
                <ul className="space-y-1 text-xs text-red-700/90">
                  {health.data!.openIncidents.map((i) => (
                    <li key={i.id}>
                      <span className="font-medium capitalize">{i.component.replace(/_/g, " ")}</span> —{" "}
                      {i.state} since {formatTimeAgo(i.started_at)}
                      {i.detail ? `: ${i.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Measurement & response latency"
          description="55.16 RPM SLA metrics, last 7 days."
        >
          {sla.isLoading ? (
            <CenterNote>Loading…</CenterNote>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-charcoal-ink/50">Measurement latency (avg)</p>
                <p className="font-heading text-xl font-semibold text-charcoal-ink">
                  {formatDuration(sla.data?.measurement_latency_seconds.avg ?? null)}
                </p>
              </div>
              <div>
                <p className="text-xs text-charcoal-ink/50">Clinician ack latency (avg)</p>
                <p className="font-heading text-xl font-semibold text-charcoal-ink">
                  {sla.data?.alert_ack_latency_minutes.avg != null
                    ? `${Math.round(sla.data.alert_ack_latency_minutes.avg)}m`
                    : "—"}
                </p>
                <p className="text-xs text-charcoal-ink/40">{sla.data?.alert_ack_latency_minutes.count ?? 0} acked alerts</p>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Technical downtime by component" description="55.16, summed over the window.">
          <MiniBarList
            items={(sla.data?.technical_downtime_minutes_by_component ?? []).map((d) => ({
              label: d.component,
              value: d.downtime_minutes,
              display: `${Math.round(d.downtime_minutes)}m`,
            }))}
            emptyLabel="No downtime recorded in this window."
          />
        </SectionCard>
      </div>

      <SectionCard title="Data quality by connection" description="55.10 — missing data, abnormal transmission, duplicates, latency, errors.">
        {quality.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : q.length === 0 ? (
          <CenterNote>No wearable connections or paired devices in this organisation yet.</CenterNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                  <th className="py-2 pr-4 font-medium">Kind</th>
                  <th className="py-2 pr-4 font-medium">Provider/type</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Last synced</th>
                  <th className="py-2 pr-4 text-right font-medium">Implausible</th>
                  <th className="py-2 pr-4 text-right font-medium">Duplicates</th>
                  <th className="py-2 pr-4 text-right font-medium">Avg latency</th>
                  <th className="py-2 pr-4 font-medium">Last error</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {q.map((row) => (
                  <tr key={row.connection_id} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/70">{row.connection_kind.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 capitalize text-charcoal-ink/80">{row.provider_or_device_type.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={row.status === "active" ? (row.is_missing_data ? "amber" : "green") : row.status === "error" ? "red" : "grey"}>
                        {row.is_missing_data ? "stale" : row.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-charcoal-ink/60">{formatTimeAgo(row.last_synced_at)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(row.implausible_readings_count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(row.duplicate_readings_count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatDuration(row.avg_latency_seconds)}</td>
                    <td className="max-w-48 truncate py-2 pr-4 text-xs text-red-700" title={row.last_error ?? undefined}>
                      {row.last_error ?? "—"}
                    </td>
                    <td className="py-2 text-right">
                      {row.connection_kind === "wearable" && row.status !== "disconnected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={revokingId === row.connection_id}
                          onClick={() => handleRevoke(row)}
                        >
                          <Timer className="mr-1 h-3 w-3" />
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
