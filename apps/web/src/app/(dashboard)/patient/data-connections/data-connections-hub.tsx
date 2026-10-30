"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { t, type MessageKey } from "@tarragon/i18n";
import { buildConnectionRows, getProposedConfig, type ConnectionRow, type ConsentCategory, type HubHealthConfig } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/client";
import {
  useDeleteWearableConnectionData,
  useSetWearableConnectionStatus,
  useUpdateWearableConsent,
  useWearableConnections,
} from "@/lib/queries/wearable-connections";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const CATEGORIES: ConsentCategory[] = ["activity", "heart_rate", "sleep", "weight"];
const tr = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, "en", params);

/** Last data for the two sources that are not wearable connections: paired Bluetooth devices and the newest typed reading. */
function useOtherSources(patientId: string) {
  return useQuery({
    queryKey: ["data-connections-other", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const [devices, manual] = await Promise.all([
        supabase.from("patient_devices").select("id, device_type, nickname, last_synced_at").eq("patient_id", patientId).eq("status", "active"),
        supabase.from("vitals_readings").select("taken_at").eq("patient_id", patientId).in("source", ["manual", "photo_confirmed"]).order("taken_at", { ascending: false }).limit(1),
      ]);
      if (devices.error || manual.error) throw new Error("load");
      return {
        ble: (devices.data ?? []).map((d) => ({ id: d.id, deviceType: d.device_type, nickname: d.nickname, lastSyncedAt: d.last_synced_at })),
        lastManualReadingAt: manual.data?.[0]?.taken_at ?? null,
      };
    },
    staleTime: 30_000,
    retry: false,
  });
}

function lastSyncText(row: ConnectionRow): string {
  if (row.daysSinceSync === null) return tr("hub.last_sync_never");
  return row.daysSinceSync === 0 ? tr("hub.last_sync_today") : tr("hub.last_sync", { days: row.daysSinceSync });
}

const TONE: Record<ConnectionRow["status"], "green" | "grey" | "red"> = {
  connected: "green",
  paused: "grey",
  reconnect_needed: "red",
  no_recent_data: "grey",
  waiting_first_sync: "grey",
  not_connected: "grey",
  unavailable: "grey",
};

export function DataConnectionsHub({ patientId, unavailableProviders }: { patientId: string; unavailableProviders: string[] }) {
  const connections = useWearableConnections(patientId);
  const other = useOtherSources(patientId);
  const setStatus = useSetWearableConnectionStatus(patientId);
  const updateConsent = useUpdateWearableConsent(patientId);
  const deleteData = useDeleteWearableConnectionData(patientId);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (connections.isError || other.isError) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-300">
        {tr("hub.error.load")}
      </p>
    );
  }
  if (connections.isLoading || other.isLoading || !connections.data || !other.data) {
    return <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">…</p>;
  }

  const cfg = getProposedConfig("devices.connection_health").value as unknown as HubHealthConfig;
  const rows = buildConnectionRows(
    {
      wearableConnections: connections.data.map((c) => ({
        id: c.id,
        provider: c.provider,
        status: c.status,
        connectedAt: c.connected_at,
        lastSyncedAt: c.last_synced_at,
        lastSyncError: c.last_sync_error,
        consent: { activity: c.consent_activity, heart_rate: c.consent_heart_rate, sleep: c.consent_sleep, weight: c.consent_weight },
      })),
      bleDevices: other.data.ble,
      lastManualReadingAt: other.data.lastManualReadingAt,
      unavailableProviders,
      now: new Date(),
    },
    cfg,
  );

  const fail = () => setMessage(tr("hub.error.action"));

  return (
    <div className="space-y-3">
      {message && <p role="status" className="text-sm">{message}</p>}
      {rows.map((row) => (
        <Card key={row.key}>
          <CardContent className="space-y-2 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{row.nickname ?? tr(row.labelKey)}</p>
                <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{lastSyncText(row)}</p>
              </div>
              <Badge variant={TONE[row.status]}>{tr(row.statusKey)}</Badge>
            </div>
            {row.hintKey && <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{tr(row.hintKey)}</p>}
            {row.kind === "health_store" && !row.connectionId && <p className="text-xs">{tr("hub.hint.phone_setup")}</p>}

            {row.controls.consent && row.connectionId && (
              <fieldset className="space-y-1">
                <legend className="text-xs font-semibold">{tr("hub.consent.title")}</legend>
                {CATEGORIES.map((category) => (
                  <label key={category} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.controls.consent![category]}
                      disabled={updateConsent.isPending}
                      onChange={(e) => updateConsent.mutate({ connectionId: row.connectionId!, category, granted: e.target.checked }, { onError: fail })}
                    />
                    {tr(`hub.consent.${category}`)}
                  </label>
                ))}
                <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{tr("hub.consent.safety_note")}</p>
              </fieldset>
            )}

            <div className="flex flex-wrap gap-2">
              {row.connectionId && row.controls.canPause && (
                <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ connectionId: row.connectionId!, status: "paused" }, { onError: fail })}>
                  {tr("hub.action.pause")}
                </Button>
              )}
              {row.connectionId && row.controls.canResume && (
                <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ connectionId: row.connectionId!, status: "active" }, { onError: fail })}>
                  {tr("hub.action.resume")}
                </Button>
              )}
              {row.controls.canReconnect && (
                <Button size="sm" asChild>
                  <a href={`/api/wearables/connect/${row.sourceId}`}>{tr("hub.action.reconnect")}</a>
                </Button>
              )}
              {row.connectionId && row.controls.canDisconnect && (
                <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ connectionId: row.connectionId!, status: "disconnected" }, { onError: fail })}>
                  {tr("hub.action.disconnect")}
                </Button>
              )}
              {row.connectionId && row.controls.canDeleteData && (
                <Button size="sm" variant="outline" onClick={() => setConfirming(row.key)}>
                  {tr("hub.action.delete")}
                </Button>
              )}
            </div>

            {confirming === row.key && row.connectionId && (
              <div className="rounded-lg border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
                <p className="text-sm">{tr("hub.delete.warning")}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={deleteData.isPending}
                    onClick={() =>
                      deleteData.mutate(row.connectionId!, {
                        onSuccess: () => {
                          setConfirming(null);
                          setMessage(tr("hub.delete.done"));
                        },
                        onError: fail,
                      })
                    }
                  >
                    {tr("hub.delete.confirm")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
                    {tr("hub.delete.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
