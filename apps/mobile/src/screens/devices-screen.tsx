import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Device } from "react-native-ble-plx";
import type { Tables } from "@tarragon/shared";
import { requestBlePermissions, scanForClinicalDevices, type SupportedDeviceType } from "@/lib/ble";
import { supabase } from "@/lib/supabase";
import { colors, spacing } from "@/ui/theme";
import { Card, ErrorText, MutedText, PrimaryButton, ScreenTitle, SecondaryButton } from "@/ui/components";

type PatientDevice = Tables<"patient_devices">;

interface DevicesScreenProps {
  patientId: string;
  organisationId: string;
  onOpenDevice: (device: PatientDevice) => void;
}

const DEVICE_LABELS: Record<string, string> = {
  bp_cuff: "Blood pressure cuff",
  glucometer: "Glucometer",
  scale: "Weight scale",
  thermometer: "Thermometer",
  pulse_oximeter: "Pulse oximeter",
};

function deviceLabel(deviceType: string): string {
  return DEVICE_LABELS[deviceType] ?? deviceType;
}

function deviceIcon(deviceType: string): keyof typeof Ionicons.glyphMap {
  if (deviceType === "bp_cuff") return "heart-outline";
  if (deviceType === "glucometer") return "water-outline";
  if (deviceType === "thermometer") return "thermometer-outline";
  if (deviceType === "pulse_oximeter") return "pulse-outline";
  return "scale-outline";
}

/**
 * Paired-device list + pairing flow. Pairing itself (the patient_devices
 * insert) goes straight through the patient's own RLS-scoped session, same
 * as any other patient-authored row — no server round-trip needed, unlike
 * reading ingestion which must go through the API route to guarantee the
 * BP-control pipeline fires (see apps/web/src/app/api/mobile/device-readings/route.ts).
 */
export function DevicesScreen({ patientId, organisationId, onOpenDevice }: DevicesScreenProps) {
  const [devices, setDevices] = useState<PatientDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairing, setPairing] = useState(false);
  const [found, setFound] = useState<{ device: Device; deviceType: SupportedDeviceType }[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("patient_devices")
      .select("*")
      .eq("patient_id", patientId)
      .eq("status", "active")
      .order("paired_at", { ascending: false });
    setDevices(data ?? []);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    if (!pairing) return;
    setFound([]);
    setScanError(null);
    let stopScan: (() => void) | undefined;

    requestBlePermissions().then((granted) => {
      if (!granted) {
        setScanError("Bluetooth permission is required to pair a device.");
        return;
      }
      stopScan = scanForClinicalDevices(
        (device, deviceType) => {
          setFound((prev) => (prev.some((f) => f.device.id === device.id) ? prev : [...prev, { device, deviceType }]));
        },
        (error) => setScanError(error.message)
      );
    });

    return () => stopScan?.();
  }, [pairing]);

  async function handlePair(device: Device, deviceType: SupportedDeviceType) {
    const { error } = await supabase.from("patient_devices").insert({
      patient_id: patientId,
      organisation_id: organisationId,
      device_type: deviceType,
      ble_device_id: device.id,
      model: device.name ?? device.localName ?? null,
    });
    if (!error) {
      setPairing(false);
      await loadDevices();
    }
  }

  return (
    <View style={{ flex: 1, padding: spacing.screen, gap: 14, backgroundColor: colors.background }}>
      <ScreenTitle>Your devices</ScreenTitle>
      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: 10 }}
          ListEmptyComponent={
            <Card style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
              <Ionicons name="bluetooth-outline" size={28} color={colors.faint} />
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>
                No devices paired yet
              </Text>
              <MutedText>
                Pair your BP cuff, glucometer, scale, thermometer, or pulse oximeter to sync readings automatically.
              </MutedText>
            </Card>
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => onOpenDevice(item)}>
              {({ pressed }) => (
                <Card style={{ opacity: pressed ? 0.7 : 1 }}>
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
                      <Ionicons name={deviceIcon(item.device_type)} size={20} color={colors.brand} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>
                        {item.nickname ?? item.model ?? deviceLabel(item.device_type)}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>
                        {deviceLabel(item.device_type)} · Last synced:{" "}
                        {item.last_synced_at ? new Date(item.last_synced_at).toLocaleDateString() : "never"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.faint} />
                  </View>
                </Card>
              )}
            </Pressable>
          )}
        />
      )}
      <PrimaryButton title="Pair a new device" onPress={() => setPairing(true)} />

      <Modal visible={pairing} animationType="slide" onRequestClose={() => setPairing(false)}>
        <View style={{ flex: 1, padding: spacing.screen, gap: 14, backgroundColor: colors.background }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator color={colors.brand} />
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.ink }}>
              Scanning for devices…
            </Text>
          </View>
          <MutedText>
            Turn on your device (BP cuff, glucometer, scale, thermometer, or pulse oximeter) and put it in pairing mode.
          </MutedText>
          {scanError ? <ErrorText>{scanError}</ErrorText> : null}
          <FlatList
            data={found}
            keyExtractor={(item) => item.device.id}
            contentContainerStyle={{ gap: 10 }}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => handlePair(item.device, item.deviceType)}
              >
                {({ pressed }) => (
                  <Card style={{ opacity: pressed ? 0.7 : 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "600", color: colors.ink }}>
                      {item.device.name ?? item.device.localName ?? item.device.id}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>
                      {deviceLabel(item.deviceType)} · Tap to pair
                    </Text>
                  </Card>
                )}
              </Pressable>
            )}
          />
          <SecondaryButton title="Cancel" onPress={() => setPairing(false)} />
        </View>
      </Modal>
    </View>
  );
}
