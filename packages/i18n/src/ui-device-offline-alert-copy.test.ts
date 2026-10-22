import { describe, expect, it } from "@jest/globals";
import { en } from "./en";
import { t } from "./translate";
import { deviceSyncState, lastSyncedInWords, queueNoteView, UI_C_COPY_REVIEW, uiDeviceOfflineAlertCopy } from "./ui-device-offline-alert-copy";

const say = (key: keyof typeof uiDeviceOfflineAlertCopy, params?: Record<string, string | number>) => t(key, "en", params);
const keys = Object.keys(uiDeviceOfflineAlertCopy) as (keyof typeof uiDeviceOfflineAlertCopy)[];

describe("UI-C copy", () => {
  it("is in the English catalogue, under reviewed prefixes, and marked pending CMO review", () => {
    for (const k of keys) {
      expect(en[k]).toBe(uiDeviceOfflineAlertCopy[k]);
      expect(UI_C_COPY_REVIEW.prefixes.some((p) => k.startsWith(p))).toBe(true);
    }
    expect(UI_C_COPY_REVIEW.status).toBe("pending_cmo_review");
    for (const k of UI_C_COPY_REVIEW.clinicalKeys) expect(keys).toContain(k);
  });

  it("keeps the warm voice: no exclamation marks, no em dash, no WARNING, care team not doctor", () => {
    for (const k of keys) {
      const text = uiDeviceOfflineAlertCopy[k];
      expect(text).not.toMatch(/!/);
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/WARNING|urgent|danger|emergency/i);
      expect(text).not.toMatch(/your doctor/i);
    }
  });

  it("uses the exact three state words and the exact offline sentence", () => {
    expect(en["devicesync.state.working"]).toBe("Working");
    expect(en["devicesync.state.needs_fix"]).toBe("Needs a quick fix");
    expect(en["devicesync.state.not_set_up"]).toBe("Not set up");
    expect(en["offline.saved_note"]).toBe("Saved on this phone. It will send when you are online.");
  });
});

describe("deviceSyncState", () => {
  it("is working for an active device with no error, even before its first reading", () => {
    expect(deviceSyncState({ status: "active" })).toBe("working");
    expect(deviceSyncState({ status: "active", lastSyncError: "" })).toBe("working");
  });
  it("needs a fix on an error status or a recorded sync error", () => {
    expect(deviceSyncState({ status: "error" })).toBe("needs_fix");
    expect(deviceSyncState({ status: "active", lastSyncError: "token expired" })).toBe("needs_fix");
  });
  it("is not set up when unpaired, disconnected, paused or unknown, whatever the last error says", () => {
    for (const status of ["unpaired", "disconnected", "paused", null, undefined]) {
      expect(deviceSyncState({ status, lastSyncError: "old error" })).toBe("not_set_up");
    }
  });
});

describe("lastSyncedInWords (Africa/Lagos)", () => {
  // 2026-10-20 12:00 Lagos is 11:00 UTC.
  const now = Date.parse("2026-10-20T11:00:00Z");
  it("says today with the Lagos clock time", () => {
    expect(lastSyncedInWords("2026-10-20T07:10:00Z", now, say)).toBe("Today at 8:10");
  });
  it("uses the Lagos calendar day, not the UTC day", () => {
    // 23:30 UTC on the 19th is 00:30 Lagos on the 20th: today.
    expect(lastSyncedInWords("2026-10-19T23:30:00Z", now, say)).toBe("Today at 0:30");
    // 22:30 UTC on the 19th is 23:30 Lagos on the 19th: yesterday.
    expect(lastSyncedInWords("2026-10-19T22:30:00Z", now, say)).toBe("Yesterday at 23:30");
  });
  it("counts days, then weeks, then a long time", () => {
    expect(lastSyncedInWords("2026-10-17T11:00:00Z", now, say)).toBe("3 days ago");
    expect(lastSyncedInWords("2026-10-02T11:00:00Z", now, say)).toBe("2 weeks ago");
    expect(lastSyncedInWords("2026-07-01T11:00:00Z", now, say)).toBe("More than 2 months ago");
  });
  it("says not synced yet for nothing or a bad date, and never negative days for a clock set ahead", () => {
    expect(lastSyncedInWords(null, now, say)).toBe("Not synced yet");
    expect(lastSyncedInWords("not a date", now, say)).toBe("Not synced yet");
    expect(lastSyncedInWords("2026-10-21T11:00:00Z", now, say)).toBe("Today at 12:00");
  });
});

describe("queueNoteView", () => {
  it("shows only when something is waiting", () => {
    expect(queueNoteView(0).show).toBe(false);
    expect(queueNoteView(-3).show).toBe(false);
    expect(queueNoteView(Number.NaN).show).toBe(false);
    expect(queueNoteView(2)).toMatchObject({ show: true, count: 2 });
    expect(t(queueNoteView(2).badgeKey, "en", { count: 2 })).toBe("2 waiting to send");
  });
});
