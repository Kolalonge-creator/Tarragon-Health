import { getProposedConfig } from "@tarragon/shared";
import { deviceSyncState, lastSyncedInWords, needsFix, shortDateInWords, t, type DeviceSyncState, type MessageKey } from "@tarragon/i18n";

/**
 * What a device row says (UI-C change 9): a plain state, when it last synced in words, one sentence that says what the state means
 * (also the words shown when there is no audio clip), and the label of the single Green fix button, if there is one.
 */
export interface DeviceRowView {
  state: DeviceSyncState;
  stateLabel: string;
  lastSynced: string;
  explain: string;
  /** Null when no fix is needed: a working or waiting device gets no fix button. */
  fixLabel: string | null;
  /** The audio clip for this state, when one has been recorded. None exist yet, so the words above are what people get. */
  clipId: string | null;
}

/** Recorded clips by state. Left empty on purpose: a clip is added here only after it is recorded and signed off. */
export const DEVICE_STATE_CLIP: Readonly<Record<DeviceSyncState, string | null>> = {
  working: null,
  needs_fix: null,
  stale: null,
  waiting: null,
  paused: null,
  not_set_up: null,
};

const say = (key: MessageKey, params?: Record<string, string | number>) => t(key, "en", params);

/** The staleness limit is PROPOSED configuration (devices.sync_staleness), never a literal here. */
function staleAfterDays(): number {
  return getProposedConfig<{ staleAfterDays: number }>("devices.sync_staleness").value.staleAfterDays;
}

export function deviceRowView(
  device: { status: string | null | undefined; lastSyncError?: string | null; lastSyncedAt?: string | null },
  nowMs: number = Date.now(),
  staleDays: number = staleAfterDays(),
): DeviceRowView {
  const state = deviceSyncState({ status: device.status, lastSyncError: device.lastSyncError, lastSyncedAt: device.lastSyncedAt }, nowMs, staleDays);
  const labelState = state === "stale" ? "needs_fix" : state;
  const fixKey = needsFix(state) ? "needs_fix" : state === "paused" || state === "not_set_up" ? state : null;
  return {
    state,
    stateLabel: say(`devicesync.state.${labelState}` as MessageKey),
    lastSynced: lastSyncedInWords(device.lastSyncedAt, nowMs, say),
    explain: state === "stale" ? say("devicesync.explain.stale", { date: shortDateInWords(device.lastSyncedAt) }) : say(`devicesync.explain.${state}` as MessageKey),
    fixLabel: fixKey ? say(`devicesync.fix.${fixKey}` as MessageKey) : null,
    clipId: DEVICE_STATE_CLIP[state],
  };
}

/** The one-line subtitle under a device name: "Blood pressure cuff · Working · Today at 8:10". */
export function deviceRowSubtitle(typeLabel: string, view: DeviceRowView): string {
  return `${typeLabel} · ${view.stateLabel} · ${view.lastSynced}`;
}

/** Which device(s) need attention, in words, for the card under a list: "Blood pressure cuff" or "Blood pressure cuff and Scale". */
export function attentionNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
