import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "./proposed-config";
import { buildConnectionRows, connectionStatusOf, hubNeedsAttention, type HubHealthConfig, type HubInput, type HubWearableConnection } from "./data-connections";

const cfg = getProposedConfig("devices.connection_health").value as unknown as HubHealthConfig;
const now = new Date("2026-10-22T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const consent = { activity: true, heart_rate: false, sleep: true, weight: true };

function conn(over: Partial<HubWearableConnection> & Pick<HubWearableConnection, "id" | "provider">): HubWearableConnection {
  return { status: "active", lastSyncedAt: daysAgo(1), lastSyncError: null, consent, ...over };
}
function input(over: Partial<HubInput> = {}): HubInput {
  return { wearableConnections: [], bleDevices: [], lastManualReadingAt: null, unavailableProviders: ["fitbit"], now, ...over };
}

describe("buildConnectionRows", () => {
  it("lists manual entry first, then every health store and cloud provider even when nothing is connected", () => {
    const rows = buildConnectionRows(input(), cfg);
    expect(rows.map((r) => r.sourceId)).toEqual(["manual", "apple_health", "android_health_connect", "oura", "whoop", "garmin", "fitbit", "dexcom"]);
    expect(rows.find((r) => r.sourceId === "oura")?.status).toBe("not_connected");
    expect(rows.find((r) => r.sourceId === "fitbit")?.status).toBe("unavailable");
    expect(rows.find((r) => r.sourceId === "fitbit")?.hintKey).toBe("hub.hint.unavailable");
  });

  it("a recent sync is connected; one past the limit is 'no recent data'; an error is 'reconnect needed'; paused is paused", () => {
    const limit = cfg.staleAfterDays.cloud_wearable;
    const rows = buildConnectionRows(
      input({
        wearableConnections: [
          conn({ id: "1", provider: "oura", lastSyncedAt: daysAgo(limit) }),
          conn({ id: "2", provider: "whoop", lastSyncedAt: daysAgo(limit + 1) }),
          conn({ id: "3", provider: "garmin", status: "error", lastSyncError: "token revoked" }),
          conn({ id: "4", provider: "dexcom", status: "paused" }),
        ],
      }),
      cfg,
    );
    const by = (id: string) => rows.find((r) => r.sourceId === id)!;
    expect(by("oura").status).toBe("connected");
    expect(by("whoop").status).toBe("no_recent_data");
    expect(by("garmin").status).toBe("reconnect_needed");
    expect(by("garmin").controls.canReconnect).toBe(true);
    expect(by("dexcom").status).toBe("paused");
    expect(by("dexcom").controls.canResume).toBe(true);
    expect(by("dexcom").controls.canPause).toBe(false);
    expect(hubNeedsAttention(rows)).toBe(true);
  });

  it("a connection that has never synced is waiting, not stale", () => {
    expect(connectionStatusOf({ status: "active", lastSyncedAt: null }, "cloud_wearable", now, cfg)).toBe("waiting_first_sync");
  });

  it("carries the per-category consent and the delete control only for a real connection", () => {
    const rows = buildConnectionRows(input({ wearableConnections: [conn({ id: "1", provider: "oura" })] }), cfg);
    const oura = rows.find((r) => r.sourceId === "oura")!;
    expect(oura.controls.consent).toEqual(consent);
    expect(oura.controls.canDeleteData).toBe(true);
    expect(oura.connectionId).toBe("1");
    expect(rows.find((r) => r.sourceId === "whoop")!.controls.canDeleteData).toBe(false);
    expect(rows.find((r) => r.sourceId === "manual")!.controls.consent).toBeNull();
  });

  it("an existing Fitbit connection stays listed and manageable, but cannot be reconnected while Fitbit is unavailable", () => {
    const rows = buildConnectionRows(input({ wearableConnections: [conn({ id: "9", provider: "fitbit", status: "error" })] }), cfg);
    const fitbit = rows.find((r) => r.sourceId === "fitbit")!;
    expect(fitbit.status).toBe("reconnect_needed");
    expect(fitbit.controls.canReconnect).toBe(false);
    expect(fitbit.controls.canDisconnect).toBe(true);
    expect(fitbit.controls.canDeleteData).toBe(true);
    // the hint must not tell the person to reconnect a service that cannot be reconnected
    expect(fitbit.hintKey).toBe("hub.hint.unavailable_existing");
    expect(fitbit.hintKey).not.toBe("hub.hint.reconnect_needed");
  });

  it("a disconnected row is shown as not connected, and an unknown provider still gets a row", () => {
    const rows = buildConnectionRows(
      input({ wearableConnections: [conn({ id: "1", provider: "oura", status: "disconnected" }), conn({ id: "2", provider: "polar" })] }),
      cfg,
    );
    expect(rows.find((r) => r.sourceId === "oura")?.status).toBe("not_connected");
    const polar = rows.find((r) => r.sourceId === "polar");
    expect(polar?.labelKey).toBe("hub.source.other");
    expect(polar?.status).toBe("connected");
  });

  it("phone health stores use their own limit and cannot be 'reconnected' from here", () => {
    const rows = buildConnectionRows(
      input({ wearableConnections: [conn({ id: "1", provider: "apple_health", status: "error" })] }),
      cfg,
    );
    const ah = rows.find((r) => r.sourceId === "apple_health")!;
    expect(ah.kind).toBe("health_store");
    expect(ah.status).toBe("reconnect_needed");
    expect(ah.controls.canReconnect).toBe(false);
  });

  it("Bluetooth devices and manual entry show their last data and go quiet after their own limit", () => {
    const rows = buildConnectionRows(
      input({
        bleDevices: [
          { id: "a", deviceType: "bp_cuff", lastSyncedAt: daysAgo(2) },
          { id: "b", deviceType: "glucometer", nickname: "  Dad's meter ", lastSyncedAt: daysAgo(cfg.staleAfterDays.bluetooth_device + 1) },
          { id: "c", deviceType: "scale", lastSyncedAt: null },
        ],
        lastManualReadingAt: daysAgo(3),
      }),
      cfg,
    );
    expect(rows.find((r) => r.key === "ble:a")?.status).toBe("connected");
    expect(rows.find((r) => r.key === "ble:b")?.status).toBe("no_recent_data");
    expect(rows.find((r) => r.key === "ble:b")?.nickname).toBe("Dad's meter");
    expect(rows.find((r) => r.key === "ble:c")?.status).toBe("waiting_first_sync");
    expect(rows.find((r) => r.key === "manual")?.status).toBe("connected");
    expect(rows.find((r) => r.key === "manual")?.daysSinceSync).toBe(3);
    expect(hubNeedsAttention(rows)).toBe(false);
  });

  it("a last sync in the future (a wrong clock) is today, not negative", () => {
    const rows = buildConnectionRows(input({ wearableConnections: [conn({ id: "1", provider: "oura", lastSyncedAt: new Date(now.getTime() + 5 * 86_400_000).toISOString() })] }), cfg);
    expect(rows.find((r) => r.sourceId === "oura")?.daysSinceSync).toBe(0);
  });

  it("the status is display only: the day limits come from configuration and are PROPOSED", () => {
    const entry = getProposedConfig("devices.connection_health");
    expect(entry.status).toBe("proposed");
    expect(entry.owner).toBe("Founder");
  });
});
