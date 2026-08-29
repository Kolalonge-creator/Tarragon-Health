import { NativeModule, requireNativeModule } from "expo-modules-core";

/**
 * Thin bridge over the Yucheng (玉成创新科技) vendor BLE SDK — YCBTClient
 * (Android, ycbtsdk-release.aar) and YCProduct (iOS, YCProductSDK.framework).
 * Deliberately narrow: connect/disconnect/scan, device info, and pulse/SpO2
 * readings only. The vendor SDK also covers ECG-with-AI-diagnosis, watch
 * faces, contacts sync, weather, OTA firmware update, alarms, and SOS — none
 * of that is wired up here; see apps/mobile/src/lib/yucheng-band.ts for why.
 *
 * This module has never been exercised against real hardware or a real
 * native build (no physical band, no macOS/Xcode available in the
 * environment that wrote it) — see that same file's header for the exact
 * verification gap before this is trusted with a real patient reading.
 */

export interface YuchengBandDevice {
  /** MAC address (Android) or CoreBluetooth peripheral UUID (iOS) — the
   * platform-native identifier, passed back into connect(). Not a globally
   * stable hardware serial (matches how ble.ts's ble_device_id already
   * works for the standard-GATT devices — per-app-install, not permanent). */
  id: string;
  name: string | null;
  /** Signal strength in dBm, when the platform reports it during scanning. */
  rssi: number | null;
}

export type YuchengBandConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "timeout";

export interface YuchengBandDeviceInfo {
  batteryPercent: number | null;
  firmwareVersion: string | null;
}

/** Mirrors ParsedReading's shape in ble.ts closely enough that
 * yucheng-band.ts can build the same device-readings payload shape the
 * existing GATT sync path already posts — not literally reused as a type,
 * since this module intentionally has no dependency on react-native-ble-plx
 * or @tarragon/shared's GATT parsers (nothing here is GATT). */
export type YuchengBandReading =
  | { kind: "pulse"; pulseBpm: number; takenAt: string }
  | { kind: "spo2"; spo2Pct: number; pulseBpm: number | null; takenAt: string };

interface YuchengBandNativeModule extends NativeModule {
  /**
   * Must be called once (idempotent) before scan/connect — Android's
   * YCBTClient.initClient needs an Application Context the JS side can't
   * supply directly. No-op on iOS (YCProductSDK needs no init call per its
   * docs — see the SDK doc's absence of any config()/appId API).
   */
  initialize(): Promise<void>;

  /**
   * Scans for `timeoutSeconds`, resolving with every Yucheng device seen.
   * Android: YCBTClient.startScanBle. iOS: YCProduct.scanningDevice
   * (delayTime), which is a single bounded call, not a stream — this method
   * has the same bounded-scan contract on both platforms so the JS caller
   * doesn't need a platform branch, unlike ble.ts's scanForClinicalDevices
   * (which is Android/iOS-symmetric already because react-native-ble-plx
   * abstracts that; this module has no such abstraction to lean on since
   * it's wrapping two unrelated vendor SDKs, not one cross-platform library).
   */
  scan(timeoutSeconds: number): Promise<YuchengBandDevice[]>;

  /** Connects to a previously-scanned device by its native id. Rejects on
   * timeout or failure — CONNECT_TIMEOUT_MS-equivalent bound is enforced
   * natively per-platform (Android via a coroutine timeout, iOS by the
   * vendor SDK's own connectDevice completion, which is not documented to
   * ever hang but is wrapped in a JS-level timeout in yucheng-band.ts as a
   * backstop — see that file). */
  connect(deviceId: string): Promise<void>;

  disconnect(deviceId: string): Promise<void>;

  /** Android: YCBTClient.connectState() mapped from Constants.BLEState.
   * iOS: YCProductState mapped from the SDK's own enum. */
  connectionState(deviceId: string): Promise<YuchengBandConnectionState>;

  /** Android: YCBTClient.getDeviceInfo. iOS: YCProduct.queryDeviceBasicInfo. */
  getDeviceInfo(deviceId: string): Promise<YuchengBandDeviceInfo>;

  /**
   * One-shot pull of whatever pulse/SpO2 history the band is currently
   * holding. Android: YCBTClient.healthHistoryData with
   * Constants.DATATYPE.Health_HistoryHeart / a combined-data type for SpO2.
   * iOS: YCProduct.queryHealthData with YCQueryHealthDataType.heartRate /
   * .combinedData. Both vendor APIs return the device's on-board history,
   * not a live stream — real-time streaming exists on Android
   * (appRealDataFromDevice) but the iOS doc describes its equivalent
   * (realTimeDataUplod) as "used in fewer scenarios, mainly used internally
   * by the SDK", so this module deliberately uses the read-history path on
   * both platforms rather than building a real-time path that's
   * asymmetric across platforms and unconfirmed on iOS.
   */
  readVitalsHistory(deviceId: string): Promise<YuchengBandReading[]>;
}

export const YuchengBand = requireNativeModule<YuchengBandNativeModule>("YuchengBand");
