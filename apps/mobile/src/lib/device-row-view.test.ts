import { describe, expect, it } from "@jest/globals";
import { attentionNames, deviceRowSubtitle, deviceRowView } from "./device-row-view";

const now = Date.parse("2026-10-20T11:00:00Z"); // 12:00 in Lagos
const DAYS = 7; // the PROPOSED limit, passed in explicitly so the test does not depend on the registry value

describe("deviceRowView", () => {
  it("working: synced recently, no fix button", () => {
    const v = deviceRowView({ status: "active", lastSyncedAt: "2026-10-20T07:10:00Z" }, now, DAYS);
    expect(v).toMatchObject({ state: "working", stateLabel: "Working", lastSynced: "Today at 8:10", fixLabel: null });
    expect(v.explain).toMatch(/arriving/);
    expect(deviceRowSubtitle("Blood pressure cuff", v)).toBe("Blood pressure cuff · Working · Today at 8:10");
  });

  it("never synced: waits for the first reading and does not claim readings are arriving", () => {
    const v = deviceRowView({ status: "active", lastSyncedAt: null }, now, DAYS);
    expect(v.state).toBe("waiting");
    expect(v.stateLabel).toBe("Waiting for the first reading");
    expect(v.explain).not.toMatch(/arriving as expected/);
    expect(v.lastSynced).toBe("Not synced yet");
  });

  it("stale: older than the limit needs a quick fix, with the fix button and the date", () => {
    const v = deviceRowView({ status: "active", lastSyncedAt: "2026-07-22T11:00:00Z" }, now, DAYS);
    expect(v.state).toBe("stale");
    expect(v.stateLabel).toBe("Needs a quick fix");
    expect(v.fixLabel).toBe("Fix this");
    expect(v.explain).toContain("No readings since 22 Jul");
    expect(deviceRowView({ status: "active", lastSyncedAt: "2026-10-13T11:00:00Z" }, now, DAYS).state).toBe("working"); // exactly the limit
    expect(deviceRowView({ status: "active", lastSyncedAt: "2026-10-13T10:59:00Z" }, now, DAYS).state).toBe("stale");
  });

  it("needs a fix on a recorded error, even if it synced today", () => {
    const v = deviceRowView({ status: "active", lastSyncError: "timeout", lastSyncedAt: "2026-10-20T07:10:00Z" }, now, DAYS);
    expect(v).toMatchObject({ state: "needs_fix", stateLabel: "Needs a quick fix", fixLabel: "Fix this" });
  });

  it("not set up: unpaired offers to set it up", () => {
    const v = deviceRowView({ status: "unpaired", lastSyncedAt: null }, now, DAYS);
    expect(v).toMatchObject({ state: "not_set_up", stateLabel: "Not set up", lastSynced: "Not synced yet", fixLabel: "Set it up" });
  });

  it("paused is Paused with Resume, never Not set up", () => {
    const v = deviceRowView({ status: "paused", lastSyncedAt: "2026-10-19T07:10:00Z" }, now, DAYS);
    expect(v).toMatchObject({ state: "paused", stateLabel: "Paused", fixLabel: "Resume" });
  });

  it("a future last-synced time reads Just now", () => {
    expect(deviceRowView({ status: "active", lastSyncedAt: "2026-10-21T11:00:00Z" }, now, DAYS).lastSynced).toBe("Just now");
  });

  it("no wording carries an exclamation mark or alarm words", () => {
    for (const status of ["active", "error", "unpaired", "paused"]) {
      const v = deviceRowView({ status, lastSyncedAt: "2026-01-01T00:00:00Z" }, now, DAYS);
      expect(`${v.stateLabel} ${v.explain} ${v.fixLabel ?? ""}`).not.toMatch(/!|WARNING|danger|urgent/i);
    }
  });

  it("reads the limit from proposed config when none is passed", () => {
    expect(deviceRowView({ status: "active", lastSyncedAt: "2026-10-20T07:10:00Z" }, now).state).toBe("working");
  });
});

describe("attentionNames", () => {
  it("names one or several devices", () => {
    expect(attentionNames(["Cuff"])).toBe("Cuff");
    expect(attentionNames(["Cuff", "Scale"])).toBe("Cuff and Scale");
    expect(attentionNames(["Cuff", "Scale", "Meter"])).toBe("Cuff, Scale and Meter");
  });
});
