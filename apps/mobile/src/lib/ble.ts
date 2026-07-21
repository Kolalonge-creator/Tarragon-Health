import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device } from "react-native-ble-plx";
import {
  BLE_CHARACTERISTIC_UUID,
  BLE_SERVICE_UUID,
  base64ToBytes,
  parseBloodPressureMeasurement,
  parseGlucoseMeasurement,
  parsePlxSpotCheckMeasurement,
  parseTemperatureMeasurement,
  parseWeightMeasurement,
  type BloodPressureReading,
  type GlucoseReading,
  type SpO2Reading,
  type TemperatureReading,
  type WeightReading,
} from "@tarragon/shared";

export type SupportedDeviceType =
  | "bp_cuff"
  | "glucometer"
  | "scale"
  | "thermometer"
  | "pulse_oximeter";

const SERVICE_TO_DEVICE_TYPE: Record<string, SupportedDeviceType> = {
  [BLE_SERVICE_UUID.bloodPressure.toLowerCase()]: "bp_cuff",
  [BLE_SERVICE_UUID.glucose.toLowerCase()]: "glucometer",
  [BLE_SERVICE_UUID.weightScale.toLowerCase()]: "scale",
  [BLE_SERVICE_UUID.healthThermometer.toLowerCase()]: "thermometer",
  [BLE_SERVICE_UUID.pulseOximeter.toLowerCase()]: "pulse_oximeter",
};

const DEVICE_TYPE_TO_GATT: Record<
  SupportedDeviceType,
  { service: string; characteristic: string }
> = {
  bp_cuff: {
    service: BLE_SERVICE_UUID.bloodPressure,
    characteristic: BLE_CHARACTERISTIC_UUID.bloodPressureMeasurement,
  },
  glucometer: {
    service: BLE_SERVICE_UUID.glucose,
    characteristic: BLE_CHARACTERISTIC_UUID.glucoseMeasurement,
  },
  scale: {
    service: BLE_SERVICE_UUID.weightScale,
    characteristic: BLE_CHARACTERISTIC_UUID.weightMeasurement,
  },
  thermometer: {
    service: BLE_SERVICE_UUID.healthThermometer,
    characteristic: BLE_CHARACTERISTIC_UUID.temperatureMeasurement,
  },
  pulse_oximeter: {
    service: BLE_SERVICE_UUID.pulseOximeter,
    characteristic: BLE_CHARACTERISTIC_UUID.plxSpotCheckMeasurement,
  },
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
 * Scan for peripherals advertising any of the supported standard GATT
 * clinical services (blood pressure, glucose, weight scale, thermometer,
 * pulse oximeter). Returns a stop function — callers must invoke it when
 * the pairing screen unmounts, since a BLE scan otherwise runs indefinitely
 * and drains the phone's battery.
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
  | ({ deviceType: "glucometer" } & GlucoseReading)
  | ({ deviceType: "scale" } & WeightReading)
  | ({ deviceType: "thermometer" } & TemperatureReading)
  | ({ deviceType: "pulse_oximeter" } & SpO2Reading);

function parseForDeviceType(deviceType: SupportedDeviceType, bytes: Uint8Array): ParsedReading {
  switch (deviceType) {
    case "bp_cuff":
      return { deviceType, ...parseBloodPressureMeasurement(bytes) };
    case "glucometer":
      return { deviceType, ...parseGlucoseMeasurement(bytes) };
    case "scale":
      return { deviceType, ...parseWeightMeasurement(bytes) };
    case "thermometer":
      return { deviceType, ...parseTemperatureMeasurement(bytes) };
    case "pulse_oximeter":
      return { deviceType, ...parsePlxSpotCheckMeasurement(bytes) };
  }
}

/**
 * Connect to an already-discovered (or previously paired) peripheral and
 * subscribe to its measurement characteristic, decoding each notification/
 * indication via the shared GATT parsers (monitorCharacteristicForService
 * handles both — weight/temperature measurements are indications per spec).
 * Returns a teardown function.
 */
export async function connectAndSubscribe(
  bleDeviceId: string,
  deviceType: SupportedDeviceType,
  onReading: (reading: ParsedReading) => void,
  onError: (error: Error) => void
): Promise<() => void> {
  const device = await getManager().connectToDevice(bleDeviceId);
  await device.discoverAllServicesAndCharacteristics();

  const { service, characteristic } = DEVICE_TYPE_TO_GATT[deviceType];

  const subscription = device.monitorCharacteristicForService(
    service,
    characteristic,
    (error, char) => {
      if (error) {
        onError(error);
        return;
      }
      if (!char?.value) return;
      try {
        onReading(parseForDeviceType(deviceType, base64ToBytes(char.value)));
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
