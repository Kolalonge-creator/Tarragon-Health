/**
 * Stand-in for react-native-ble-plx's native bridge. Records what ble.ts
 * asked the native stack to do (which service UUIDs it scanned for, which
 * characteristic it subscribed to) and lets a test push a notification
 * payload back, so the GATT service -> device-type -> parser wiring can be
 * exercised without hardware. The bit-level decoding itself lives in
 * @tarragon/shared and is tested there (device-readings.test.ts).
 */
export interface FakeSubscription {
  remove: () => void;
}

type MonitorListener = (error: Error | null, char: { value: string } | null) => void;

interface MonitorCall {
  service: string;
  characteristic: string;
  listener: MonitorListener;
}

export const state = {
  scanServiceUuids: null as string[] | null,
  scanListener: null as ((error: Error | null, device: unknown) => void) | null,
  scanStopped: false,
  /** Set to make the very first getManager()/startDeviceScan call throw the
   * way an Expo Go build (no native module compiled in) does. */
  throwOnScan: false,
  connectCalls: [] as { id: string; timeout: number | undefined }[],
  cancelledConnections: [] as string[],
  monitors: [] as MonitorCall[],
  subscriptionsRemoved: 0,
  /** Resolves/rejects/hangs the discovery step, to exercise the JS-level
   * DISCOVERY_TIMEOUT_MS backstop that has no native equivalent. */
  discoveryBehaviour: "resolve" as "resolve" | "reject" | "hang",
  connectBehaviour: "resolve" as "resolve" | "reject",
};

class FakeDevice {
  constructor(public id: string) {}

  discoverAllServicesAndCharacteristics(): Promise<FakeDevice> {
    if (state.discoveryBehaviour === "reject") return Promise.reject(new Error("discovery failed"));
    if (state.discoveryBehaviour === "hang") return new Promise(() => {});
    return Promise.resolve(this);
  }

  monitorCharacteristicForService(
    service: string,
    characteristic: string,
    listener: MonitorListener
  ): FakeSubscription {
    state.monitors.push({ service, characteristic, listener });
    return {
      remove: () => {
        state.subscriptionsRemoved += 1;
      },
    };
  }
}

export type Device = FakeDevice;

export class BleManager {
  startDeviceScan(
    serviceUuids: string[] | null,
    _options: unknown,
    listener: (error: Error | null, device: unknown) => void
  ): void {
    if (state.throwOnScan) throw new Error("BleManager is not available in this build");
    state.scanServiceUuids = serviceUuids;
    state.scanListener = listener;
  }

  stopDeviceScan(): void {
    state.scanStopped = true;
  }

  connectToDevice(id: string, options?: { timeout?: number }): Promise<FakeDevice> {
    state.connectCalls.push({ id, timeout: options?.timeout });
    if (state.connectBehaviour === "reject") return Promise.reject(new Error("connect failed"));
    return Promise.resolve(new FakeDevice(id));
  }

  cancelDeviceConnection(id: string): Promise<void> {
    state.cancelledConnections.push(id);
    return Promise.resolve();
  }
}

export function __reset(): void {
  state.scanServiceUuids = null;
  state.scanListener = null;
  state.scanStopped = false;
  state.throwOnScan = false;
  state.connectCalls = [];
  state.cancelledConnections = [];
  state.monitors = [];
  state.subscriptionsRemoved = 0;
  state.discoveryBehaviour = "resolve";
  state.connectBehaviour = "resolve";
}

export function __emitScanResult(device: { id: string; serviceUUIDs?: string[] | null }): void {
  state.scanListener?.(null, device);
}

export function __emitNotification(base64Value: string): void {
  state.monitors[state.monitors.length - 1]?.listener(null, { value: base64Value });
}
