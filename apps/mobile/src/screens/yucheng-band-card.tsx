import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Tables } from "@tarragon/shared";
import type { YuchengBandDevice } from "@/lib/yucheng-band";
import {
  connectYuchengBand,
  disconnectYuchengBand,
  requestYuchengBandPermissions,
  scanForYuchengBand,
  syncYuchengBandReadings,
} from "@/lib/yucheng-band";
import { supabase } from "@/lib/supabase";
import { colors, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, SecondaryButton } from "@/ui/components";

type PatientDevice = Tables<"patient_devices">;

interface YuchengBandCardProps {
  patientId: string;
  organisationId: string;
  /** The same list DevicesScreen already loaded from patient_devices — this
   * card doesn't run its own query, it just looks for a 'smart_band' row,
   * so the parent stays the single source of truth for the device list. */
  devices: PatientDevice[];
  /** Called after a successful pairing so the parent re-fetches — same
   * shape as devices-screen.tsx's own handlePair -> loadDevices(). */
  onPaired: () => void;
}

/**
 * BLE wearable band card — separate from the standard-GATT pairing flow
 * devices-screen.tsx already has (that one scans for bp_cuff/glucometer/
 * scale/thermometer/pulse_oximeter via react-native-ble-plx; this one talks
 * to a single specific vendor SDK via expo-yucheng-band). Deliberately its
 * own component rather than folded into the existing pairing modal, so nothing
 * about that working flow changes.
 *
 * Same never-run-on-real-hardware caveat as every other native module in
 * this codebase — see yucheng-band.ts's header.
 */
export function YuchengBandCard({ patientId, organisationId, devices, onPaired }: YuchengBandCardProps) {
  const paired = useMemo(
    () => devices.find((device) => device.device_type === "smart_band") ?? null,
    [devices]
  );

  if (paired) {
    return <PairedBandCard device={paired} />;
  }
  return <UnpairedBandCard patientId={patientId} organisationId={organisationId} onPaired={onPaired} />;
}

function CardHeader() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: "#E8F3EE",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="watch-outline" size={20} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>Wearable band</Text>
        <MutedText>Heart rate and oxygen readings from a paired band</MutedText>
      </View>
    </View>
  );
}

function UnpairedBandCard({
  patientId,
  organisationId,
  onPaired,
}: Pick<YuchengBandCardProps, "patientId" | "organisationId" | "onPaired">) {
  const [pairing, setPairing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<YuchengBandDevice[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    setFound([]);
    setError(null);
    setScanning(true);

    requestYuchengBandPermissions()
      .then((granted) => {
        if (cancelled) return;
        if (!granted) {
          setError("Bluetooth permission is required to pair a band.");
          setScanning(false);
          return;
        }
        return scanForYuchengBand();
      })
      .then((devices) => {
        if (cancelled || !devices) return;
        setFound(devices);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pairing]);

  async function handleConnect(device: YuchengBandDevice) {
    setConnectingId(device.id);
    setError(null);
    try {
      await connectYuchengBand(device.id);
      const { error: insertError } = await supabase.from("patient_devices").insert({
        patient_id: patientId,
        organisation_id: organisationId,
        device_type: "smart_band",
        manufacturer: "Yucheng",
        model: device.name,
        ble_device_id: device.id,
      });
      if (insertError) throw new Error(insertError.message);
      setPairing(false);
      onPaired();
    } catch (err) {
      await disconnectYuchengBand(device.id);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectingId(null);
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <CardHeader />
      <MutedText>
        Pair a compatible wearable band to bring its heart rate and oxygen readings into your
        record automatically, alongside everything you log yourself.
      </MutedText>
      <PrimaryButton title="Pair a band" onPress={() => setPairing(true)} />

      <Modal visible={pairing} animationType="slide" onRequestClose={() => setPairing(false)}>
        <View style={{ flex: 1, padding: spacing.screen, gap: 14, backgroundColor: colors.background }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {scanning ? <ActivityIndicator color={colors.brand} /> : null}
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>
              {scanning ? "Scanning for your band…" : "Nearby bands"}
            </Text>
          </View>
          <MutedText>Turn on your band and keep it nearby.</MutedText>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <FlatList
            data={found}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ gap: 10 }}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                disabled={connectingId !== null}
                onPress={() => handleConnect(item)}
              >
                {({ pressed }) => (
                  <Card style={{ opacity: pressed || connectingId === item.id ? 0.7 : 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>
                      {item.name ?? item.id}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>
                      {connectingId === item.id ? "Connecting…" : "Tap to pair"}
                    </Text>
                  </Card>
                )}
              </Pressable>
            )}
            ListEmptyComponent={
              !scanning ? (
                <Card style={{ alignItems: "center", paddingVertical: 20 }}>
                  <MutedText>No bands found yet. Make sure it&apos;s on and nearby.</MutedText>
                </Card>
              ) : null
            }
          />
          <SecondaryButton title="Cancel" onPress={() => setPairing(false)} disabled={connectingId !== null} />
        </View>
      </Modal>
    </Card>
  );
}

function PairedBandCard({ device }: { device: PatientDevice }) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      await connectYuchengBand(device.ble_device_id);
      try {
        const result = await syncYuchengBandReadings(device.id, device.ble_device_id);
        const total = result.uploaded + result.failed;
        setMessage(
          total === 0
            ? "No new readings on the band right now."
            : result.failed === 0
              ? `Added ${result.uploaded} ${result.uploaded === 1 ? "reading" : "readings"} to your record.`
              : `Added ${result.uploaded} of ${total} readings — the rest will retry next sync.`
        );
      } finally {
        await disconnectYuchengBand(device.ble_device_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [device.ble_device_id, device.id]);

  return (
    <Card style={{ gap: 10 }}>
      <CardHeader />
      <MutedText>
        {device.nickname ?? device.model ?? "Your band"} · Last synced:{" "}
        {device.last_synced_at ? new Date(device.last_synced_at).toLocaleDateString() : "never"}
      </MutedText>
      <PrimaryButton title={syncing ? "Syncing…" : "Sync band"} onPress={handleSync} disabled={syncing} loading={syncing} />
      {message ? (
        <Text style={{ color: colors.success, fontSize: 14, fontWeight: "600" }}>{message}</Text>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  );
}
