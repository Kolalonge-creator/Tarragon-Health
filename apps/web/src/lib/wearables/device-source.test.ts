import { describe, expect, it } from "@jest/globals";
import { DEVICE_SOURCES, describeDeviceSources, getDeviceSource, type DeviceSourceEnv } from "./device-source";
import { PROVIDER_ADAPTERS } from "./providers";

const none: DeviceSourceEnv = { isCloudConfigured: () => false };
const all: DeviceSourceEnv = { isCloudConfigured: () => true };

describe("DeviceSource wraps the existing adapters instead of replacing them", () => {
  it("each cloud source carries the same adapter object the sync code already uses", () => {
    for (const id of ["fitbit", "whoop", "oura", "garmin", "dexcom"] as const) {
      expect(getDeviceSource(id).adapter).toBe(PROVIDER_ADAPTERS[id]);
    }
  });
  it("source ids are unique", () => {
    const ids = DEVICE_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("a source is available only when it really is", () => {
  it("cloud providers need developer credentials: without them nothing claims to be available", () => {
    for (const id of ["fitbit", "whoop", "oura", "garmin", "dexcom"] as const) {
      expect(getDeviceSource(id).status(none).state).toBe("not_yet_available");
      expect(getDeviceSource(id).status(all).state).toBe("available");
    }
  });
  it("the slots with no integration stay unavailable even if every credential were present", () => {
    expect(getDeviceSource("withings").status(all).state).toBe("not_yet_available");
    expect(getDeviceSource("libre").status(all).state).toBe("not_yet_available");
    expect(getDeviceSource("personal_ecg").status(all).state).toBe("not_yet_available");
    expect(getDeviceSource("cgm_partner").status(all).state).toBe("not_yet_available");
  });
  it("Samsung is reached through Health Connect, not a flow of its own", () => {
    const s = getDeviceSource("samsung_health");
    expect(s.adapter).toBeNull();
    expect(s.status().state).toBe("via_other_source");
    expect(s.status().reason).toMatch(/Health Connect/);
  });
  it("inhaler sensors are not built and the Tarragon band is paused by decision D-22", () => {
    expect(getDeviceSource("inhaler_sensor").status().state).toBe("not_built");
    expect(getDeviceSource("tarragon_band").status().state).toBe("paused");
    expect(getDeviceSource("tarragon_band").status().reason).toMatch(/D-22/);
  });
  it("photo capture is available and is its own sync kind", () => {
    expect(getDeviceSource("photo_capture").status().state).toBe("available");
    expect(getDeviceSource("photo_capture").syncKind).toBe("photo");
  });
});

describe("what a screen would render", () => {
  it("describes every source with a plain reason, in English, with no dash punctuation or promise of a cure", () => {
    const rows = describeDeviceSources(none);
    expect(rows).toHaveLength(DEVICE_SOURCES.length);
    for (const r of rows) {
      expect(r.reason.length).toBeGreaterThan(10);
      expect(`${r.label} ${r.reason}`).not.toMatch(/—|–| cure|free healthcare|your doctor|instant doctor/i);
    }
  });
});
