/**
 * The "Data connections" screen model (S70b, item 9): one list of every way a reading can reach the record, each with a plain status, so a person
 * can see what is connected, what has gone quiet, and what they can switch off or delete. Pure: it reads rows the screens already load and the clock,
 * and returns rows to draw. It reads no database, sends nothing and changes nothing; the buttons on the screen call the EXISTING controls
 * (pause/resume, revoke_wearable_connection, delete_wearable_connection_data, the per-category consent columns).
 *
 * A status here is DISPLAY ONLY. "Reconnect needed" pages nobody, hides no reading and changes no triage. The day counts are PROPOSED configuration
 * (`devices.connection_health`, owner Founder, unsigned) and arrive as an argument, never as a literal.
 *
 * Wording: `labelKey`, `statusKey` and `hintKey` are @tarragon/i18n message keys (the `hub.*` namespace). They are plain strings here so this package
 * stays free of the i18n dependency; apps/web/src/lib/data-connections-keys.test.ts proves every key exists.
 */

export type ConnectionKind = "manual" | "bluetooth_device" | "health_store" | "cloud_wearable";

export type ConnectionStatus =
  | "connected" //          syncing, recent data
  | "paused" //             the person paused it
  | "reconnect_needed" //   the provider refused our access (an error state); the person must reconnect
  | "no_recent_data" //     connected and not in error, but nothing has arrived for longer than expected
  | "waiting_first_sync" // connected, nothing has arrived yet
  | "not_connected" //      available, not set up
  | "unavailable"; //       switched off for new connections (for example Fitbit while its legacy interface ends)

export interface HubHealthConfig {
  readonly staleAfterDays: {
    readonly cloud_wearable: number;
    readonly health_store: number;
    readonly bluetooth_device: number;
    readonly manual: number;
  };
}

export interface HubWearableConnection {
  readonly id: string;
  readonly provider: string;
  /** 'disconnected' rows are not listed as connected (the person removed them). */
  readonly status: "active" | "paused" | "error" | "disconnected";
  readonly connectedAt?: string | null;
  readonly lastSyncedAt: string | null;
  readonly lastSyncError: string | null;
  readonly consent: { readonly activity: boolean; readonly heart_rate: boolean; readonly sleep: boolean; readonly weight: boolean };
}

export interface HubBleDevice {
  readonly id: string;
  readonly deviceType: string;
  readonly nickname?: string | null;
  readonly lastSyncedAt: string | null;
}

export interface HubInput {
  readonly wearableConnections: readonly HubWearableConnection[];
  readonly bleDevices: readonly HubBleDevice[];
  /** Newest reading the person typed in themselves (source manual or photo_confirmed). null when there is none. */
  readonly lastManualReadingAt: string | null;
  /** Cloud providers switched off for NEW connections (see oauth-providers.ts). They still show if the person already has a row. */
  readonly unavailableProviders: readonly string[];
  /** Whether the phone health store of this device kind is one the person can set up here. Web shows both as "set up on your phone". */
  readonly now: Date;
}

export type ConsentCategory = "activity" | "heart_rate" | "sleep" | "weight";

export interface ConnectionRow {
  /** Stable key for lists. */
  readonly key: string;
  readonly kind: ConnectionKind;
  /** Provider name, 'ble:<device id>', or 'manual'. */
  readonly sourceId: string;
  readonly labelKey: string;
  /** Present for a Bluetooth device whose label is a device type; the screen shows the nickname instead when one exists. */
  readonly nickname: string | null;
  readonly status: ConnectionStatus;
  readonly statusKey: string;
  /** One calm sentence about what to do, or null. */
  readonly hintKey: string | null;
  readonly lastSyncAt: string | null;
  /** Whole days since the last sync, or null when never. */
  readonly daysSinceSync: number | null;
  /** The connection row this acts on (wearable_connections.id), when there is one. */
  readonly connectionId: string | null;
  readonly controls: {
    /** Per-category consent switches. Only cloud wearables and health stores carry them. */
    readonly consent: Readonly<Record<ConsentCategory, boolean>> | null;
    readonly canPause: boolean;
    readonly canResume: boolean;
    /** Disconnect: stops future reads and clears stored access. */
    readonly canDisconnect: boolean;
    /** Delete everything this connection has synced (delete_wearable_connection_data). */
    readonly canDeleteData: boolean;
    readonly canReconnect: boolean;
  };
}

const DAY_MS = 86_400_000;

const CLOUD_PROVIDERS = ["oura", "whoop", "garmin", "fitbit", "dexcom"] as const;
const HEALTH_STORES = ["apple_health", "android_health_connect"] as const;

/** Every provider value the wearable_connections table can hold, mapped to how we show it. Unknown values are shown as a cloud wearable with a generic label. */
function kindOf(provider: string): ConnectionKind {
  return (HEALTH_STORES as readonly string[]).includes(provider) ? "health_store" : "cloud_wearable";
}

function labelKeyOf(provider: string): string {
  const known = [...CLOUD_PROVIDERS, ...HEALTH_STORES, "libre", "withings"] as readonly string[];
  return known.includes(provider) ? `hub.source.${provider}` : "hub.source.other";
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

function staleLimit(kind: ConnectionKind, cfg: HubHealthConfig): number {
  return cfg.staleAfterDays[kind];
}

const NO_CONTROLS: ConnectionRow["controls"] = {
  consent: null,
  canPause: false,
  canResume: false,
  canDisconnect: false,
  canDeleteData: false,
  canReconnect: false,
};

const STATUS_KEY: Record<ConnectionStatus, string> = {
  connected: "hub.status.connected",
  paused: "hub.status.paused",
  reconnect_needed: "hub.status.reconnect_needed",
  no_recent_data: "hub.status.no_recent_data",
  waiting_first_sync: "hub.status.waiting_first_sync",
  not_connected: "hub.status.not_connected",
  unavailable: "hub.status.unavailable",
};

const HINT_KEY: Partial<Record<ConnectionStatus, string>> = {
  paused: "hub.hint.paused",
  reconnect_needed: "hub.hint.reconnect_needed",
  no_recent_data: "hub.hint.no_recent_data",
  waiting_first_sync: "hub.hint.waiting_first_sync",
  unavailable: "hub.hint.unavailable",
};

export function connectionStatusOf(
  c: Pick<HubWearableConnection, "status" | "lastSyncedAt">,
  kind: ConnectionKind,
  now: Date,
  cfg: HubHealthConfig,
): ConnectionStatus {
  if (c.status === "paused") return "paused";
  if (c.status === "error") return "reconnect_needed";
  const d = daysSince(c.lastSyncedAt, now);
  if (d === null) return "waiting_first_sync";
  return d > staleLimit(kind, cfg) ? "no_recent_data" : "connected";
}

/**
 * The rows for the screen, in a fixed order: the readings the person types themselves, then Bluetooth devices, then the phone health stores, then each
 * cloud wearable. Every cloud provider is listed (so a person can see what they could connect, or that Fitbit is unavailable) and every provider the
 * person already has a row for is listed even if it is not in the known list. A disconnected row is not shown as connected.
 */
export function buildConnectionRows(input: HubInput, cfg: HubHealthConfig): ConnectionRow[] {
  const { now } = input;
  const rows: ConnectionRow[] = [];

  // 1. Manual entry: always there, never "not connected".
  const manualDays = daysSince(input.lastManualReadingAt, now);
  rows.push({
    key: "manual",
    kind: "manual",
    sourceId: "manual",
    labelKey: "hub.source.manual",
    nickname: null,
    status: manualDays === null || manualDays > staleLimit("manual", cfg) ? "no_recent_data" : "connected",
    statusKey: STATUS_KEY[manualDays === null || manualDays > staleLimit("manual", cfg) ? "no_recent_data" : "connected"],
    hintKey: null,
    lastSyncAt: input.lastManualReadingAt,
    daysSinceSync: manualDays,
    connectionId: null,
    controls: NO_CONTROLS,
  });

  // 2. Bluetooth devices the person has paired.
  for (const d of input.bleDevices) {
    const days = daysSince(d.lastSyncedAt, now);
    const status: ConnectionStatus = days === null ? "waiting_first_sync" : days > staleLimit("bluetooth_device", cfg) ? "no_recent_data" : "connected";
    rows.push({
      key: `ble:${d.id}`,
      kind: "bluetooth_device",
      sourceId: `ble:${d.id}`,
      labelKey: `hub.device.${d.deviceType}`,
      nickname: d.nickname?.trim() ? d.nickname.trim() : null,
      status,
      statusKey: STATUS_KEY[status],
      hintKey: HINT_KEY[status] ?? null,
      lastSyncAt: d.lastSyncedAt,
      daysSinceSync: days,
      connectionId: null,
      controls: NO_CONTROLS,
    });
  }

  // 3 and 4. Phone health stores, then cloud wearables: rows that exist, plus the known providers that do not exist yet.
  const live = input.wearableConnections.filter((c) => c.status !== "disconnected");
  const byProvider = new Map<string, HubWearableConnection>();
  for (const c of live) if (!byProvider.has(c.provider)) byProvider.set(c.provider, c);

  const order = [...HEALTH_STORES, ...CLOUD_PROVIDERS, ...live.map((c) => c.provider).filter((p) => ![...HEALTH_STORES, ...CLOUD_PROVIDERS].includes(p as never))];
  const seen = new Set<string>();
  for (const provider of order) {
    if (seen.has(provider)) continue;
    seen.add(provider);
    const kind = kindOf(provider);
    const conn = byProvider.get(provider);
    const unavailable = input.unavailableProviders.includes(provider);
    if (!conn) {
      const status: ConnectionStatus = unavailable ? "unavailable" : "not_connected";
      rows.push({
        key: `wc:${provider}`,
        kind,
        sourceId: provider,
        labelKey: labelKeyOf(provider),
        nickname: null,
        status,
        statusKey: STATUS_KEY[status],
        hintKey: HINT_KEY[status] ?? null,
        lastSyncAt: null,
        daysSinceSync: null,
        connectionId: null,
        controls: NO_CONTROLS,
      });
      continue;
    }
    const status = connectionStatusOf(conn, kind, now, cfg);
    // A switched-off service cannot be reconnected, so its hint must not say "Reconnect it".
    const hintKey = unavailable && (status === "reconnect_needed" || status === "no_recent_data") ? "hub.hint.unavailable_existing" : HINT_KEY[status] ?? null;
    rows.push({
      key: `wc:${provider}`,
      kind,
      sourceId: provider,
      labelKey: labelKeyOf(provider),
      nickname: null,
      status,
      statusKey: STATUS_KEY[status],
      hintKey,
      lastSyncAt: conn.lastSyncedAt,
      daysSinceSync: daysSince(conn.lastSyncedAt, now),
      connectionId: conn.id,
      controls: {
        consent: { ...conn.consent },
        canPause: conn.status === "active",
        canResume: conn.status === "paused",
        canDisconnect: true,
        canDeleteData: true,
        // Reconnect is only offered for a cloud provider that can start a new connection (not an unavailable one, not a phone health store, which is set up on the phone).
        canReconnect: status === "reconnect_needed" && kind === "cloud_wearable" && !unavailable,
      },
    });
  }
  return rows;
}

/** True when anything on the list needs the person to do something (drives a single dot on the hub's entry point). */
export function hubNeedsAttention(rows: readonly ConnectionRow[]): boolean {
  return rows.some((r) => r.status === "reconnect_needed");
}
