import { describe, expect, it } from "@jest/globals";
import { en } from "@tarragon/i18n";
import { buildConnectionRows, getProposedConfig, type HubHealthConfig } from "@tarragon/shared";

const PROVIDERS = ["apple_health", "android_health_connect", "oura", "whoop", "garmin", "fitbit", "dexcom", "libre", "withings", "other_x"];

describe("Data connections wording", () => {
  const cfg = getProposedConfig("devices.connection_health").value as unknown as HubHealthConfig;
  const consent = { activity: true, heart_rate: true, sleep: true, weight: true };
  const rows = buildConnectionRows(
    {
      wearableConnections: PROVIDERS.flatMap((provider, i) => [
        { id: `a${i}`, provider, status: (["active", "paused", "error"] as const)[i % 3]!, lastSyncedAt: null, lastSyncError: null, consent },
      ]),
      bleDevices: ["bp_cuff", "glucometer", "scale", "thermometer", "pulse_oximeter", "smart_band", "ecg", "peak_flow_meter"].map((deviceType) => ({ id: deviceType, deviceType, lastSyncedAt: null })),
      lastManualReadingAt: null,
      unavailableProviders: ["fitbit"],
      now: new Date(),
    },
    cfg,
  );

  it("every label, status and hint key the screen can show exists in the English catalogue", () => {
    const keys = new Set<string>(["hub.hint.phone_setup", "hub.hint.unavailable_existing", "hub.notice.unavailable", "hub.last_sync", "hub.last_sync_today", "hub.last_sync_never"]);
    for (const c of ["activity", "heart_rate", "sleep", "weight"]) keys.add(`hub.consent.${c}`);
    for (const r of rows) for (const k of [r.labelKey, r.statusKey, r.hintKey]) if (k) keys.add(k);
    expect([...keys].filter((k) => !(k in en))).toEqual([]);
  });

  it("no new copy uses an em dash or says 'your doctor'", () => {
    for (const [k, v] of Object.entries(en).filter(([key]) => /^(hub|cle|hbp|prd)\./.test(key))) {
      expect([k, /—|your doctor/i.test(v)]).toEqual([k, false]);
    }
  });
});
