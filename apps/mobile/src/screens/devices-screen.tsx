import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Button, FlatList, Modal, Text, View } from "react-native";
import type { Device } from "react-native-ble-plx";
import type { Tables } from "@tarragon/shared";
import { requestBlePermissions, scanForClinicalDevices, type SupportedDeviceType } from "@/lib/ble";
import { supabase } from "@/lib/supabase";

type PatientDevice = Tables<"patient_devices">;

interface DevicesScreenProps {
  patientId: string;
  organisationId: string;
  onOpenDevice: (device: PatientDevice) => void;
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
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "600" }}>Your devices</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text>No devices paired yet.</Text>}
          renderItem={({ item }) => (
            <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: "#eee" }}>
              <Text style={{ fontSize: 16 }} onPress={() => onOpenDevice(item)}>
                {item.nickname ?? item.model ?? item.device_type} ({item.device_type})
              </Text>
              <Text style={{ color: "#666", fontSize: 12 }}>
                Last synced: {item.last_synced_at ?? "never"}
              </Text>
            </View>
          )}
        />
      )}
      <Button title="Pair a new device" onPress={() => setPairing(true)} />

      <Modal visible={pairing} animationType="slide" onRequestClose={() => setPairing(false)}>
        <View style={{ flex: 1, padding: 16, gap: 12 }}>
          <Text style={{ fontSize: 20, fontWeight: "600" }}>Scanning for devices…</Text>
          <Text style={{ color: "#666" }}>
            Turn on your blood pressure cuff or glucometer and put it in pairing mode.
          </Text>
          {scanError ? <Text style={{ color: "#B3261E" }}>{scanError}</Text> : null}
          <FlatList
            data={found}
            keyExtractor={(item) => item.device.id}
            renderItem={({ item }) => (
              <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: "#eee" }}>
                <Text
                  style={{ fontSize: 16 }}
                  onPress={() => handlePair(item.device, item.deviceType)}
                >
                  {item.device.name ?? item.device.localName ?? item.device.id} ({item.deviceType})
                </Text>
              </View>
            )}
          />
          <Button title="Cancel" onPress={() => setPairing(false)} />
        </View>
      </Modal>
    </View>
  );
}
