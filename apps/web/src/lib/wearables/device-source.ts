import { isWearableProviderConfigured, type CloudOAuthWearableProvider } from "./oauth-providers";
import { PROVIDER_ADAPTERS, type ProviderAdapter } from "./providers";

/**
 * S70: one typed description of every place a reading can come from.
 *
 * The cloud providers already have adapters (`providers/`) that turn a webhook body, an inline push or a pull window into
 * normalised readings. This interface does not replace them. It wraps them so that the screens, the sync status and the
 * "connect a device" list ask one question ("what is this source and can a patient use it today?") and so that Withings,
 * Samsung and a personal ECG device are additions to a list, not a rewrite of the sync code.
 *
 * A source that cannot be used today says so plainly and says why; none is faked. No credential is invented: a cloud source is
 * `available` only when its developer client id and secret are present in the environment (the same check the connect route
 * makes), and the three slots below that have no integration stay `not_yet_available` or `not_built`.
 */
export type DeviceSourceId =
  | "fitbit"
  | "whoop"
  | "oura"
  | "garmin"
  | "dexcom"
  | "libre"
  | "withings"
  | "apple_health"
  | "health_connect"
  | "samsung_health"
  | "ble_clinical"
  | "cgm_partner"
  | "photo_capture"
  | "personal_ecg"
  | "inhaler_sensor"
  | "tarragon_band";

export type DeviceSourceTransport = "webhook" | "inline_push" | "pull" | "mobile_bridge" | "ble" | "camera" | "none";

/** What a patient or an operator can do with this source right now. */
export type DeviceSourceState =
  | "available"
  /** Built end to end, waiting on developer credentials or a partner agreement. */
  | "not_yet_available"
  /** Reached through another source (Samsung Health writes into Health Connect). */
  | "via_other_source"
  /** Deliberately not built, with a recorded reason. */
  | "not_built"
  /** Built or buildable, switched off by a founder decision. */
  | "paused";

export interface DeviceSourceStatus {
  state: DeviceSourceState;
  /** Plain words for a screen or a log. English only. */
  reason: string;
}

export interface DeviceSource {
  readonly id: DeviceSourceId;
  readonly label: string;
  readonly transport: DeviceSourceTransport;
  /** The existing adapter this source wraps, when it has one. */
  readonly adapter: ProviderAdapter | null;
  /** The value `device.synced` carries as `source_kind`. */
  readonly syncKind: "ble" | "wearable_cloud" | "health_store" | "cgm" | "photo" | null;
  status(env?: DeviceSourceEnv): DeviceSourceStatus;
}

/** Injected so tests do not depend on process.env. */
export interface DeviceSourceEnv {
  isCloudConfigured(provider: CloudOAuthWearableProvider): boolean;
}

const processEnv: DeviceSourceEnv = { isCloudConfigured: isWearableProviderConfigured };

function cloud(
  id: CloudOAuthWearableProvider,
  label: string,
  transport: DeviceSourceTransport,
  syncKind: DeviceSource["syncKind"]
): DeviceSource {
  return {
    id,
    label,
    transport,
    adapter: PROVIDER_ADAPTERS[id],
    syncKind,
    status: (env = processEnv) =>
      env.isCloudConfigured(id)
        ? { state: "available", reason: "Connected through the provider's own sign-in." }
        : { state: "not_yet_available", reason: "Built and waiting for developer credentials from the provider." },
  };
}

const slot = (
  id: DeviceSourceId,
  label: string,
  transport: DeviceSourceTransport,
  syncKind: DeviceSource["syncKind"],
  fixed: DeviceSourceStatus
): DeviceSource => ({ id, label, transport, adapter: null, syncKind, status: () => fixed });

export const DEVICE_SOURCES: readonly DeviceSource[] = [
  cloud("fitbit", "Fitbit", "webhook", "wearable_cloud"),
  cloud("whoop", "WHOOP", "webhook", "wearable_cloud"),
  cloud("oura", "Oura", "webhook", "wearable_cloud"),
  cloud("garmin", "Garmin", "inline_push", "wearable_cloud"),
  cloud("dexcom", "Dexcom", "pull", "cgm"),
  slot("libre", "Abbott FreeStyle Libre", "none", "cgm", {
    state: "not_yet_available",
    reason: "Abbott has no self-serve developer programme. Needs a data-sharing agreement with Abbott.",
  }),
  slot("withings", "Withings", "webhook", "wearable_cloud", {
    state: "not_yet_available",
    reason: "Provider slot only. No Withings developer credentials exist and no adapter is written until they do.",
  }),
  slot("apple_health", "Apple Health", "mobile_bridge", "health_store", {
    state: "available",
    reason: "Read on the phone by the Tarragon app. Not run on a physical iPhone yet.",
  }),
  slot("health_connect", "Health Connect", "mobile_bridge", "health_store", {
    state: "available",
    reason: "Read on the phone by the Tarragon app. Not run on a physical Android phone yet.",
  }),
  slot("samsung_health", "Samsung Health", "mobile_bridge", "health_store", {
    state: "via_other_source",
    reason: "Samsung Health writes into Health Connect, so a Samsung user connects through Health Connect.",
  }),
  slot("ble_clinical", "Bluetooth blood pressure monitor, glucometer, scale, thermometer or oximeter", "ble", "ble", {
    state: "available",
    reason: "Standard Bluetooth profiles. Never tested against real hardware (OQ-313).",
  }),
  slot("cgm_partner", "Continuous glucose monitor through a partner", "inline_push", "cgm", {
    state: "not_yet_available",
    reason: "The partner route exists. No CGM partner is active (cgm_partners has one inactive placeholder).",
  }),
  slot("photo_capture", "Photo of a device screen", "camera", "photo", {
    state: "available",
    reason: "Any device with a screen. The patient confirms every number. The photo stays on the phone.",
  }),
  slot("personal_ecg", "Personal single-lead ECG device", "mobile_bridge", null, {
    state: "not_yet_available",
    reason: "A device's own rhythm result can be reported; a vendor connector (for example KardiaMobile) is not built. Apple Watch ECG read is a seam, not run on a device.",
  }),
  slot("inhaler_sensor", "Connected inhaler sensor", "none", null, {
    state: "not_built",
    reason: "No distributor or clinical protocol in Nigeria. The slot exists so a sensor is an addition later (18.7).",
  }),
  slot("tarragon_band", "Tarragon wearable band", "none", null, {
    state: "paused",
    reason: "Band purchasing is paused until the pilot proves the care journey (decision D-22).",
  }),
];

export function getDeviceSource(id: DeviceSourceId): DeviceSource {
  const found = DEVICE_SOURCES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown device source ${id}`);
  return found;
}

export interface DeviceSourceSummary {
  id: DeviceSourceId;
  label: string;
  transport: DeviceSourceTransport;
  state: DeviceSourceState;
  reason: string;
}

/** What the "Connect a device" and sync-status screens render. A device is never required: manual entry is outside this list. */
export function describeDeviceSources(env: DeviceSourceEnv = processEnv): DeviceSourceSummary[] {
  return DEVICE_SOURCES.map((s) => ({ id: s.id, label: s.label, transport: s.transport, ...s.status(env) }));
}
