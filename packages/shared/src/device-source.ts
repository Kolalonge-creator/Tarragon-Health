/**
 * The DeviceSource interface (S70a, function 18.x "Connectors behind a DeviceSource interface").
 *
 * Every way a reading can arrive from a device or a health-data provider implements the same four verbs, so adding a connector is one
 * adapter and one flag, and the rest of the platform (plausibility, de-duplication, triage, source badge) never knows which one it was.
 *
 *   connect    start (or, for a local source, record) the person's permission
 *   sync       fetch what the source holds for a window
 *   normalise  turn the source's raw shape into readings the platform understands
 *   revoke     end the permission and stop future reads
 *
 * Adapters are PURE where they can be: they never write to the database. The one place readings become rows is the ingestion boundary
 * (apps/web/src/lib/wearables/ingest.ts and the mobile device-readings route), which applies the same plausibility, de-duplication and
 * triage to every source. A connector never decides what is clinically important.
 */

export type DeviceSourceKind = "ble_device" | "vendor_cloud" | "phone_mirror" | "photo_confirmed" | "manual";

/** One normalised measurement. Blood pressure carries the diastolic value in `secondaryValue`, as in the wearable normaliser. */
export interface DeviceSourceReading {
  readingType: string;
  value: number;
  secondaryValue?: number;
  unit: string;
  /** ISO-8601 instant the metric describes. */
  recordedAt: string;
  /** Stable per (source, reading) so a redelivery de-duplicates. */
  externalReadingId: string;
}

export interface DeviceConnectContext {
  patientId: string;
  organisationId: string;
  /** Where the provider should send the person back to (cloud sources). */
  redirectUri?: string;
  /** Anti-forgery token the caller verifies on return. */
  state?: string;
}

export type DeviceConnectResult =
  | { ok: true; kind: "redirect"; url: string }
  | { ok: true; kind: "granted" }
  | { ok: false; error: string; reason: "not_configured" | "not_supported" | "denied" | "failed" };

export interface DeviceSyncWindow {
  since: Date;
  until: Date;
}
export type DeviceSyncResult =
  | { ok: true; readings: DeviceSourceReading[] }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      /** Why, for a caller that must treat the reasons differently (a source that cannot be pulled is not an error; a missing token is skipped quietly). */
      code?: "not_pullable" | "no_token" | "provider_error";
      /** The original exception for "provider_error", so a caller that always rethrew keeps rethrowing the same thing. */
      cause?: unknown;
    };

export type DeviceRevokeResult = { ok: true } | { ok: false; error: string };

export interface DeviceSource<TConnection = unknown> {
  /** Stable id: the provider name for a cloud source, "ble", "healthkit", "health_connect" or "photo" for local ones. */
  readonly id: string;
  readonly kind: DeviceSourceKind;
  /** The per-source go-live switch (platform_modules key) that must be on before the source is offered. null: not gated here. */
  readonly goLiveKey: string | null;
  connect(ctx: DeviceConnectContext): Promise<DeviceConnectResult>;
  sync(connection: TConnection, window: DeviceSyncWindow): Promise<DeviceSyncResult>;
  /** Pure: raw payload (a webhook body, an API response, a parsed GATT value) to readings. Never throws; unknown shapes give []. */
  normalise(raw: unknown): DeviceSourceReading[];
  revoke(connection: TConnection): Promise<DeviceRevokeResult>;
}

export class DeviceSourceRegistry<TConnection = unknown> {
  private readonly sources = new Map<string, DeviceSource<TConnection>>();

  register(source: DeviceSource<TConnection>): this {
    if (this.sources.has(source.id)) throw new Error(`DeviceSource "${source.id}" is already registered`);
    this.sources.set(source.id, source);
    return this;
  }

  get(id: string): DeviceSource<TConnection> | undefined {
    return this.sources.get(id);
  }

  list(): DeviceSource<TConnection>[] {
    return [...this.sources.values()];
  }
}
