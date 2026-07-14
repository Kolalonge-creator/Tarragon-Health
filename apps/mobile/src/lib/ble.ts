import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device } from "react-native-ble-plx";
import {
  BLE_CHARACTERISTIC_UUID,
  BLE_SERVICE_UUID,
  base64ToBytes,
  parseBloodPressureMeasurement,
  parseGlucoseMeasurement,
  type BloodPressureReading,
  type GlucoseReading,
} from "@tarragon/shared";

export type SupportedDeviceType = "bp_cuff" | "glucometer";

const SERVICE_TO_DEVICE_TYPE: Record<string, SupportedDeviceType> = {
  [BLE_SERVICE_UUID.bloodPressure.toLowerCase()]: "bp_cuff",
  [BLE_SERVICE_UUID.glucose.toLowerCase()]: "glucometer",
};

let manager: BleManager | undefined;

/** Lazily constructed — instantiating BleManager touches native modules,
 * which don't exist under Jest, so this must never run at import time. */
function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  return Object.values(granted).every((status) => status === PermissionsAndroid.RESULTS.GRANTED);
}

/**
 * Scan for peripherals advertising the standard Blood Pressure or Glucose
 * GATT service. Returns a stop function — callers must invoke it when the
 * pairing screen unmounts, since a BLE scan otherwise runs indefinitely and
 * drains the phone's battery.
 */
export function scanForClinicalDevices(
  onDeviceFound: (device: Device, deviceType: SupportedDeviceType) => void,
  onError: (error: Error) => void
): () => void {
  const serviceUuids = Object.values(BLE_SERVICE_UUID);
  getManager().startDeviceScan(serviceUuids, { allowDuplicates: false }, (error, device) => {
    if (error) {
      onError(error);
      return;
    }
    if (!device) return;
    const matchedService = device.serviceUUIDs?.find(
      (uuid) => SERVICE_TO_DEVICE_TYPE[uuid.toLowerCase()]
    );
    if (!matchedService) return;
    onDeviceFound(device, SERVICE_TO_DEVICE_TYPE[matchedService.toLowerCase()]);
  });

  return () => getManager().stopDeviceScan();
}

export type ParsedReading =
  | ({ deviceType: "bp_cuff" } & BloodPressureReading)
  | ({ deviceType: "glucometer" } & GlucoseReading);

/**
 * Connect to an already-discovered (or previously paired) peripheral and
 * subscribe to its measurement characteristic notifications, decoding each
 * one via the shared GATT parsers. Returns a teardown function.
 */
export async function connectAndSubscribe(
  bleDeviceId: string,
  deviceType: SupportedDeviceType,
  onReading: (reading: ParsedReading) => void,
  onError: (error: Error) => void
): Promise<() => void> {
  const device = await getManager().connectToDevice(bleDeviceId);
  await device.discoverAllServicesAndCharacteristics();

  const serviceUuid = deviceType === "bp_cuff" ? BLE_SERVICE_UUID.bloodPressure : BLE_SERVICE_UUID.glucose;
  const characteristicUuid =
    deviceType === "bp_cuff"
      ? BLE_CHARACTERISTIC_UUID.bloodPressureMeasurement
      : BLE_CHARACTERISTIC_UUID.glucoseMeasurement;

  const subscription = device.monitorCharacteristicForService(
    serviceUuid,
    characteristicUuid,
    (error, characteristic) => {
      if (error) {
        onError(error);
        return;
      }
      if (!characteristic?.value) return;
      try {
        const bytes = base64ToBytes(characteristic.value);
        if (deviceType === "bp_cuff") {
          onReading({ deviceType, ...parseBloodPressureMeasurement(bytes) });
        } else {
          onReading({ deviceType, ...parseGlucoseMeasurement(bytes) });
        }
      } catch (parseError) {
        onError(parseError instanceof Error ? parseError : new Error(String(parseError)));
      }
    }
  );

  return () => {
    subscription.remove();
    getManager()
      .cancelDeviceConnection(bleDeviceId)
      .catch(() => undefined);
  };
}
