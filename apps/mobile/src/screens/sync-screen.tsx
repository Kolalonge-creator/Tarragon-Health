import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Tables } from "@tarragon/shared";
import { connectAndSubscribe, type ParsedReading, type SupportedDeviceType } from "@/lib/ble";
import { postDeviceReading } from "@/lib/api";
import { enqueueDeviceReading, flushDeviceReadingsQueue } from "@/lib/offline-queue";
import { colors, spacing } from "@/ui/theme";
import {
  Card,
  ChoiceChip,
  ErrorText,
  MutedText,
  PrimaryButton,
  ScreenTitle,
  SecondaryButton,
} from "@/ui/components";

type PatientDevice = Tables<"patient_devices">;
type GlucoseContext = "fasting" | "random" | "post_meal";

interface PendingReading {
  /** Doubles as the idempotency key posted as external_reading_id. */
  id: string;
  reading: ParsedReading;
  /** "queued" means the upload itself failed (most likely offline) but the
   * reading was captured into the offline queue (offline-queue.ts) rather
   * than lost — see save() below. "error" is reserved for the queue write
   * itself failing too, which would mean the reading genuinely isn't stored
   * anywhere yet. */
  status: "pending" | "saving" | "saved" | "queued" | "error";
  error?: string;
  /** Remembered from the save attempt so a retry after "error" doesn't have
   * to re-ask the fasting/random/after-a-meal question. */
  glucoseContext?: GlucoseContext;
}

interface SyncScreenProps {
  device: PatientDevice;
  onBack: () => void;
}

const SUPPORTED_TYPES: readonly SupportedDeviceType[] = [
  "bp_cuff",
  "glucometer",
  "scale",
  "thermometer",
  "pulse_oximeter",
];

function isSupported(deviceType: string): deviceType is SupportedDeviceType {
  return (SUPPORTED_TYPES as readonly string[]).includes(deviceType);
}

/**
 * Only Glucose Measurement carries a device-side sequence number; every
 * other characteristic's idempotency key is derived locally from the
 * timestamp + values — stable across a retry of *this* submit, but can't
 * dedupe a genuine device-side replay of the same historical record, which
 * is a GATT-spec limitation, not a gap in this code.
 */
function readingKey(reading: ParsedReading): string {
  switch (reading.deviceType) {
    case "bp_cuff":
      return `${reading.timestamp ?? new Date().toISOString()}-${reading.systolic}-${reading.diastolic}`;
    case "glucometer":
      return `glucose-${reading.sequenceNumber}`;
    case "scale":
      return `weight-${reading.timestamp ?? new Date().toISOString()}-${reading.weightKg}`;
    case "thermometer":
      return `temp-${reading.timestamp ?? new Date().toISOString()}-${reading.temperatureC}`;
    case "pulse_oximeter":
      return `spo2-${reading.timestamp ?? new Date().toISOString()}-${reading.spo2Pct}`;
  }
}

function ReadingValue({ reading }: { reading: ParsedReading }) {
  const unitStyle = { fontSize: 14, fontWeight: "400" as const, color: colors.muted };
  const valueStyle = { fontSize: 20, fontWeight: "700" as const, color: colors.ink };
  switch (reading.deviceType) {
    case "bp_cuff":
      return (
        <Text style={valueStyle}>
          {reading.systolic}/{reading.diastolic} <Text style={unitStyle}>mmHg</Text>
          {reading.pulseBpm ? <Text style={unitStyle}> · {reading.pulseBpm} bpm</Text> : null}
        </Text>
      );
    case "glucometer":
      return (
        <Text style={valueStyle}>
          {reading.glucoseMmolL ?? "—"} <Text style={unitStyle}>mmol/L</Text>
        </Text>
      );
    case "scale":
      return (
        <Text style={valueStyle}>
          {reading.weightKg} <Text style={unitStyle}>kg</Text>
        </Text>
      );
    case "thermometer":
      return (
        <Text style={valueStyle}>
          {reading.temperatureC} <Text style={unitStyle}>°C</Text>
        </Text>
      );
    case "pulse_oximeter":
      return (
        <Text style={valueStyle}>
          {reading.spo2Pct} <Text style={unitStyle}>% SpO2</Text>
          {reading.pulseBpm ? <Text style={unitStyle}> · {reading.pulseBpm} bpm</Text> : null}
        </Text>
      );
  }
}

/**
 * Connects to an already-paired peripheral, live-decodes its measurement
 * notifications via the shared GATT parsers, and lets the patient confirm
 * each reading before it's POSTed to the device-readings API (glucose
 * additionally needs a fasting/random/post-meal answer, since the GATT
 * characteristic itself carries no such concept).
 */
export function SyncScreen({ device, onBack }: SyncScreenProps) {
  const [pending, setPending] = useState<PendingReading[]>([]);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);

  const supported = isSupported(device.device_type);

  useEffect(() => {
    // Best-effort: a patient reopening this screen after being offline is a
    // natural moment to retry anything left over from a previous session,
    // without waiting on the next 15-minute-floor background run (see
    // background-sync.ts, which also flushes this queue on its own cadence
    // as the reliable fallback for when this screen never reopens at all).
    // Best-effort by design: a failed flush just waits for the next cadence.
    flushDeviceReadingsQueue().catch(() => {});
  }, []);

  useEffect(() => {
    if (!supported) return;
    let teardown: (() => void) | undefined;
    let cancelled = false;

    connectAndSubscribe(
      device.ble_device_id,
      device.device_type as SupportedDeviceType,
      (reading) => {
        if (cancelled) return;
        const id = readingKey(reading);
        setPending((prev) => (prev.some((p) => p.id === id) ? prev : [{ id, reading, status: "pending" }, ...prev]));
      },
      (error) => setConnectError(error.message)
    )
      .then((stop) => {
        if (cancelled) {
          stop();
        } else {
          teardown = stop;
          setConnecting(false);
        }
      })
      .catch((error: unknown) => setConnectError(error instanceof Error ? error.message : String(error)));

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [device.ble_device_id, device.device_type, supported]);

  async function save(item: PendingReading, glucoseContext?: GlucoseContext) {
    setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "saving", glucoseContext } : p)));

    const { reading } = item;
    const taken_at = reading.timestamp ?? new Date().toISOString();
    const base = { device_id: device.id, external_reading_id: item.id, taken_at };
    const payload =
      reading.deviceType === "bp_cuff"
        ? {
            ...base,
            vital_type: "blood_pressure" as const,
            systolic: reading.systolic,
            diastolic: reading.diastolic,
            pulse_bpm: reading.pulseBpm,
          }
        : reading.deviceType === "glucometer"
          ? {
              ...base,
              vital_type: "glucose" as const,
              glucose_value: reading.glucoseMmolL,
              glucose_unit: "mmol_l" as const,
              glucose_context: glucoseContext,
            }
          : reading.deviceType === "scale"
            ? { ...base, vital_type: "weight" as const, weight_kg: reading.weightKg }
            : reading.deviceType === "thermometer"
              ? { ...base, vital_type: "temperature" as const, temperature_c: reading.temperatureC }
              : {
                  ...base,
                  vital_type: "spo2" as const,
                  spo2_pct: reading.spo2Pct,
                  pulse_bpm: reading.pulseBpm,
                };

    const result = await postDeviceReading(payload);
    if (result.success) {
      setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "saved" } : p)));
      return;
    }

    // Upload failed — most likely offline, given api.ts already retries once
    // for a request that never got a response at all. Queue it rather than
    // report a plain error: the reading is not lost, just deferred, and this
    // screen's next mount, the periodic background task, or the next health
    // sync will retry it (see offline-queue.ts).
    const queued = await enqueueDeviceReading(payload);
    setPending((prev) =>
      prev.map((p) =>
        p.id === item.id
          ? queued
            ? { ...p, status: "queued" }
            : // The one genuine failure case left: the reading could not be
              // sent *and* could not be saved locally either (e.g. device
              // storage is full) — nothing to do but be honest about it.
              { ...p, status: "error", error: "Couldn't save this reading. Please try again." }
          : p
      )
    );
  }

  if (!supported) {
    return (
      <View style={{ flex: 1, padding: spacing.screen, gap: 14, backgroundColor: colors.background }}>
        <MutedText>
          Syncing isn&apos;t supported yet for this device type ({device.device_type}).
        </MutedText>
        <SecondaryButton title="Back" onPress={onBack} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: spacing.screen, gap: 14, backgroundColor: colors.background }}>
      <ScreenTitle>{device.nickname ?? device.model ?? "Device"}</ScreenTitle>
      {connecting ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator color={colors.brand} />
          <MutedText>Connecting…</MutedText>
        </View>
      ) : null}
      {connectError ? <ErrorText>{connectError}</ErrorText> : null}
      <MutedText>Take a reading on the device to see it appear below.</MutedText>
      <FlatList
        data={pending}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 10 }}
        renderItem={({ item }) => (
          <Card style={{ gap: 10 }}>
            <ReadingValue reading={item.reading} />

            {item.status === "pending" &&
              item.reading.deviceType === "glucometer" &&
              (item.reading.glucoseMmolL === null ? (
                <MutedText>Device didn&apos;t report a concentration value.</MutedText>
              ) : (
                <View style={{ gap: 8 }}>
                  <MutedText>When was this reading taken?</MutedText>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <ChoiceChip title="Fasting" onPress={() => save(item, "fasting")} />
                    <ChoiceChip title="Random" onPress={() => save(item, "random")} />
                    <ChoiceChip title="After a meal" onPress={() => save(item, "post_meal")} />
                  </View>
                </View>
              ))}
            {item.status === "pending" && item.reading.deviceType !== "glucometer" && (
              <PrimaryButton title="Save reading" onPress={() => save(item)} />
            )}
            {item.status === "saving" && <ActivityIndicator color={colors.brand} />}
            {item.status === "saved" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={{ color: colors.success, fontWeight: "600" }}>Saved</Text>
              </View>
            )}
            {item.status === "queued" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="cloud-offline-outline" size={18} color={colors.muted} />
                <MutedText>Saved. It will finish uploading once you&apos;re back online.</MutedText>
              </View>
            )}
            {item.status === "error" && (
              <View style={{ gap: 8 }}>
                <ErrorText>{item.error}</ErrorText>
                <SecondaryButton title="Try again" onPress={() => void save(item, item.glucoseContext)} />
              </View>
            )}
          </Card>
        )}
      />
      <SecondaryButton title="Back" onPress={onBack} />
    </View>
  );
}
