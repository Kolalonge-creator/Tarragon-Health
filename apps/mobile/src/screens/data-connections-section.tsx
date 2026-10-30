import { useCallback, useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { buildConnectionRows, getProposedConfig, type ConnectionRow, type ConsentCategory, type HubHealthConfig } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";
import { fetchUnavailableWearableProviders } from "@/lib/api";
import { useUiLanguage } from "@/lib/ui-language";
import { useLegacyColors } from "@/ui/design";
import { Card, ErrorText, MutedText, SecondaryButton, SectionLabel } from "@/ui/legacy-kit";

const CATEGORIES: ConsentCategory[] = ["activity", "heart_rate", "sleep", "weight"];
function consentUpdate(category: ConsentCategory, on: boolean) {
  return category === "activity" ? { consent_activity: on } : category === "heart_rate" ? { consent_heart_rate: on } : category === "sleep" ? { consent_sleep: on } : { consent_weight: on };
}

/**
 * Data connections on the phone (S70b item 9): every source that can add readings, with a plain status, when it last sent data, per-category sharing,
 * pause, disconnect and "delete what it sent". Uses the same tables and functions as the web screen (wearable_connections, revoke_wearable_connection,
 * delete_wearable_connection_data). A status is display only. A failed load says so; it never shows an empty list as "nothing connected".
 */
export function DataConnectionsSection({ patientId }: { patientId: string }) {
  const language = asLocale(useUiLanguage());
  const tr = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, language, params);
  const colors = useLegacyColors();
  const [rows, setRows] = useState<ConnectionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const unavailable = await fetchUnavailableWearableProviders().catch(() => null);
      const [conns, devices, manual] = await Promise.all([
        supabase
          .from("wearable_connections")
          .select("id, provider, status, connected_at, last_synced_at, last_sync_error, consent_activity, consent_heart_rate, consent_sleep, consent_weight")
          .eq("patient_id", patientId)
          .in("status", ["active", "paused", "error"]),
        supabase.from("patient_devices").select("id, device_type, nickname, last_synced_at").eq("patient_id", patientId).eq("status", "active"),
        supabase.from("vitals_readings").select("taken_at").eq("patient_id", patientId).in("source", ["manual", "photo_confirmed"]).order("taken_at", { ascending: false }).limit(1),
      ]);
      if (conns.error || devices.error || manual.error) throw new Error("load");
      const cfg = getProposedConfig("devices.connection_health").value as unknown as HubHealthConfig;
      setRows(
        buildConnectionRows(
          {
            wearableConnections: (conns.data ?? []).map((c) => ({
              id: c.id,
              provider: c.provider,
              status: c.status,
              connectedAt: c.connected_at,
              lastSyncedAt: c.last_synced_at,
              lastSyncError: c.last_sync_error,
              consent: { activity: c.consent_activity, heart_rate: c.consent_heart_rate, sleep: c.consent_sleep, weight: c.consent_weight },
            })),
            bleDevices: (devices.data ?? []).map((d) => ({ id: d.id, deviceType: d.device_type, nickname: d.nickname, lastSyncedAt: d.last_synced_at })),
            lastManualReadingAt: manual.data?.[0]?.taken_at ?? null,
            // The server's one list. If it cannot be read the phone assumes nothing is unavailable (it cannot start a cloud connection anyway).
            unavailableProviders: unavailable ?? [],
            now: new Date(),
          },
          cfg,
        ),
      );
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => PromiseLike<{ error: unknown }>) {
    setBusy(true);
    setActionFailed(false);
    try {
      const { error } = await action();
      if (error) setActionFailed(true);
      else await load();
    } catch {
      setActionFailed(true);
    }
    setBusy(false);
  }

  if (failed) {
    return (
      <Card>
        <ErrorText>{tr("hub.error.load")}</ErrorText>
      </Card>
    );
  }
  if (!rows) return null;

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{tr("hub.title")}</SectionLabel>
      <MutedText>{tr("hub.intro")}</MutedText>
      {actionFailed ? <ErrorText>{tr("hub.error.action")}</ErrorText> : null}
      {rows.map((row) => {
        const last = row.daysSinceSync === null ? tr("hub.last_sync_never") : row.daysSinceSync === 0 ? tr("hub.last_sync_today") : tr("hub.last_sync", { days: row.daysSinceSync });
        const id = row.connectionId;
        return (
          <Card key={row.key} style={{ gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{row.nickname ?? tr(row.labelKey)}</Text>
            {/* the status is a word, never colour alone */}
            <Text style={{ fontSize: 13, color: row.status === "reconnect_needed" ? colors.danger : colors.muted }}>
              {tr(row.statusKey)}. {last}.
            </Text>
            {row.hintKey ? <MutedText>{tr(row.hintKey)}</MutedText> : null}
            {id && row.controls.consent ? (
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{tr("hub.consent.title")}</Text>
                {CATEGORIES.map((category) => (
                  <View key={category} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 14, color: colors.ink, flexShrink: 1 }}>{tr(`hub.consent.${category}`)}</Text>
                    <Switch
                      accessibilityLabel={tr(`hub.consent.${category}`)}
                      value={row.controls.consent![category]}
                      disabled={busy}
                      onValueChange={(on) => void run(() => supabase.from("wearable_connections").update(consentUpdate(category, on)).eq("id", id))}
                    />
                  </View>
                ))}
                <MutedText>{tr("hub.consent.safety_note")}</MutedText>
              </View>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {id && row.controls.canPause ? (
                <SecondaryButton title={tr("hub.action.pause")} disabled={busy} onPress={() => void run(() => supabase.from("wearable_connections").update({ status: "paused" }).eq("id", id))} />
              ) : null}
              {id && row.controls.canResume ? (
                <SecondaryButton title={tr("hub.action.resume")} disabled={busy} onPress={() => void run(() => supabase.from("wearable_connections").update({ status: "active" }).eq("id", id))} />
              ) : null}
              {id && row.controls.canDisconnect ? (
                <SecondaryButton title={tr("hub.action.disconnect")} disabled={busy} onPress={() => void run(() => supabase.rpc("revoke_wearable_connection", { p_connection_id: id }))} />
              ) : null}
              {id && row.controls.canDeleteData ? <SecondaryButton title={tr("hub.action.delete")} disabled={busy} onPress={() => setConfirming(row.key)} /> : null}
            </View>
            {confirming === row.key && id ? (
              <View style={{ gap: 8 }}>
                <MutedText>{tr("hub.delete.warning")}</MutedText>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <SecondaryButton
                    title={tr("hub.delete.confirm")}
                    disabled={busy}
                    onPress={() => {
                      setConfirming(null);
                      void run(() => supabase.rpc("delete_wearable_connection_data", { p_connection_id: id }));
                    }}
                  />
                  <SecondaryButton title={tr("hub.delete.cancel")} onPress={() => setConfirming(null)} />
                </View>
              </View>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}
