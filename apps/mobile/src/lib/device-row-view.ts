import { deviceSyncState, lastSyncedInWords, t, type DeviceSyncState, type MessageKey } from "@tarragon/i18n";

/**
 * What a device row says (UI-C change 9): one of three plain states, when it last synced in words, one sentence that says what the
 * state means (also the words shown when there is no audio clip), and the label of the single Green fix button, if there is one.
 */
export interface DeviceRowView {
  state: DeviceSyncState;
  stateLabel: string;
  lastSynced: string;
  explain: string;
  /** Null when the device is working: a working device gets no fix button. */
  fixLabel: string | null;
  /** The audio clip for this state, when one has been recorded. None exist yet, so the words above are what people get. */
  clipId: string | null;
}

/** Recorded clips by state. Left empty on purpose: a clip is added here only after it is recorded and signed off. */
export const DEVICE_STATE_CLIP: Readonly<Record<DeviceSyncState, string | null>> = {
  working: null,
  needs_fix: null,
  not_set_up: null,
};

const say = (key: MessageKey, params?: Record<string, string | number>) => t(key, "en", params);

export function deviceRowView(
  device: { status: string | null | undefined; lastSyncError?: string | null; lastSyncedAt?: string | null },
  nowMs: number = Date.now(),
): DeviceRowView {
  const state = deviceSyncState({ status: device.status, lastSyncError: device.lastSyncError });
  return {
    state,
    stateLabel: say(`devicesync.state.${state}` as MessageKey),
    lastSynced: lastSyncedInWords(device.lastSyncedAt, nowMs, say),
    explain: say(`devicesync.explain.${state}` as MessageKey),
    fixLabel: state === "working" ? null : say(`devicesync.fix.${state}` as MessageKey),
    clipId: DEVICE_STATE_CLIP[state],
  };
}

/** The one-line subtitle under a device name: "Blood pressure cuff · Working · Today at 8:10". */
export function deviceRowSubtitle(typeLabel: string, view: DeviceRowView): string {
  return `${typeLabel} · ${view.stateLabel} · ${view.lastSynced}`;
}
