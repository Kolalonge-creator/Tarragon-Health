import { PermissionsAndroid, Platform } from "react-native";
import {
  YuchengBand,
  type YuchengBandDevice,
  type YuchengBandDeviceInfo,
  type YuchengBandReading,
} from "expo-yucheng-band";
import { postDeviceReading } from "./api";
import { recordSyncError } from "./sync-diagnostics";

/**
 * Higher-level wrapper around the expo-yucheng-band native module — the
 * same role ble.ts plays for the standard-GATT clinical devices, kept as a
 * *separate* file rather than folded into ble.ts because this is a wholly
 * different transport (a vendor SDK, not raw GATT via react-native-ble-plx)
 * with no code paths in common. devices-screen.tsx / sync-screen.tsx and
 * their existing pairing flow for bp_cuff/glucometer/scale/thermometer/
 * pulse_oximeter are untouched by this file's existence.
 *
 * Scope: connect, read whatever pulse/SpO2 history the band is holding, and
 * upload it through the existing /api/mobile/device-readings pipeline via
 * postDeviceReading — same downstream BP-control/glucose assessment
 * trigger, same vitals_readings table, same abnormal-result pipeline any
 * other device-sourced reading already goes through (see CLAUDE.md "Device
 * & Wearable Integration"). Everything else the vendor SDK can do (ECG+AI
 * diagnosis, watch faces, contacts sync, weather, OTA firmware, alarms,
 * SOS) is out of scope — see expo-yucheng-band's own index.ts and the
 * Android/iOS module READMEs for why.
 *
 * Like every other device-sync path in this codebase, this has never run
 * against real hardware — see sync-diagnostics.ts's own header for why that
 * matters and what to do about it once a physical band exists.
 */

export type { YuchengBandDevice, YuchengBandDeviceInfo, YuchengBandReading };

const DEFAULT_SCAN_SECONDS = 6;

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  await YuchengBand.initialize();
  initialized = true;
}

export async function requestYuchengBandPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  // Same permission set ble.ts's requestBlePermissions asks for — the
  // vendor SDK talks BLE under the hood on Android just like ble-plx does,
  // so it needs the same OS-level grants.
  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  return Object.values(granted).every((status) => status === PermissionsAndroid.RESULTS.GRANTED);
}

/** Bounded scan (both platforms resolve once, after ~scanSeconds — see
 * expo-yucheng-band/index.ts's scan() doc for why this has no
 * start/stop-callback shape like ble.ts's scanForClinicalDevices). */
export async function scanForYuchengBand(
  scanSeconds: number = DEFAULT_SCAN_SECONDS
): Promise<YuchengBandDevice[]> {
  await ensureInitialized();
  try {
    return await YuchengBand.scan(scanSeconds);
  } catch (error) {
    recordSyncError("yucheng_band", "scan", error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function connectYuchengBand(deviceId: string): Promise<void> {
  await ensureInitialized();
  try {
    await YuchengBand.connect(deviceId);
  } catch (error) {
    recordSyncError("yucheng_band", `connect:${deviceId}`, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function disconnectYuchengBand(deviceId: string): Promise<void> {
  try {
    await YuchengBand.disconnect(deviceId);
  } catch (error) {
    // Teardown failures are logged, not thrown — mirrors ble.ts's own
    // best-effort disconnect (a screen unmounting shouldn't be blocked by
    // the native side failing to confirm a disconnect it may have already
    // completed).
    recordSyncError("yucheng_band", `disconnect:${deviceId}`, error);
  }
}

export async function getYuchengBandDeviceInfo(deviceId: string): Promise<YuchengBandDeviceInfo | null> {
  try {
    return await YuchengBand.getDeviceInfo(deviceId);
  } catch (error) {
    recordSyncError("yucheng_band", `getDeviceInfo:${deviceId}`, error);
    return null;
  }
}

export interface SyncYuchengBandResult {
  uploaded: number;
  failed: number;
}

/**
 * Pulls whatever pulse/SpO2 history the band currently holds and posts each
 * reading through the same /api/mobile/device-readings boundary the
 * standard-GATT devices use (see api.ts's postDeviceReading) — same
 * shape (device_id, external_reading_id, taken_at, vital_type, ...) as
 * sync-screen.tsx already builds for a bp_cuff/glucometer/etc reading,
 * just constructed here instead of from a live GATT notification.
 *
 * external_reading_id is derived from the reading's own kind + timestamp
 * rather than a device-supplied sequence number (the vendor SDK's history
 * pull doesn't expose one) — stable across a re-sync of the same on-device
 * history, which is what vitals_readings_device_dedupe_idx needs to treat a
 * resync as a no-op rather than a duplicate insert.
 */
export async function syncYuchengBandReadings(
  patientDeviceId: string,
  deviceId: string
): Promise<SyncYuchengBandResult> {
  let readings: YuchengBandReading[];
  try {
    readings = await YuchengBand.readVitalsHistory(deviceId);
  } catch (error) {
    recordSyncError("yucheng_band", `readVitalsHistory:${deviceId}`, error);
    throw error instanceof Error ? error : new Error(String(error));
  }

  let uploaded = 0;
  let failed = 0;

  for (const reading of readings) {
    const externalReadingId = `yucheng:${reading.kind}:${reading.takenAt}`;
    // source: "wearable" — deliberate, not the endpoint's "device" default.
    // This band is a consumer wrist-worn optical sensor, not the same
    // confidence level as the validated standard-GATT pulse oximeter/heart-
    // rate devices this endpoint was originally built for; see
    // device-reading.ts's deviceSourceField comment.
    const payload =
      reading.kind === "pulse"
        ? {
            vital_type: "pulse" as const,
            device_id: patientDeviceId,
            external_reading_id: externalReadingId,
            taken_at: reading.takenAt,
            pulse_bpm: reading.pulseBpm,
            source: "wearable" as const,
          }
        : {
            vital_type: "spo2" as const,
            device_id: patientDeviceId,
            external_reading_id: externalReadingId,
            taken_at: reading.takenAt,
            spo2_pct: reading.spo2Pct,
            pulse_bpm: reading.pulseBpm ?? undefined,
            source: "wearable" as const,
          };

    const result = await postDeviceReading(payload);
    if (result.success) {
      uploaded += 1;
    } else {
      failed += 1;
      recordSyncError("yucheng_band", `upload:${reading.kind}`, new Error(result.error ?? "Upload failed"));
    }
  }

  return { uploaded, failed };
}
