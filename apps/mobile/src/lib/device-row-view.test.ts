import { describe, expect, it } from "@jest/globals";
import { deviceRowSubtitle, deviceRowView } from "./device-row-view";

const now = Date.parse("2026-10-20T11:00:00Z"); // 12:00 in Lagos

describe("deviceRowView", () => {
  it("working: no fix button, last synced in words", () => {
    const v = deviceRowView({ status: "active", lastSyncedAt: "2026-10-20T07:10:00Z" }, now);
    expect(v).toMatchObject({ state: "working", stateLabel: "Working", lastSynced: "Today at 8:10", fixLabel: null });
    expect(deviceRowSubtitle("Blood pressure cuff", v)).toBe("Blood pressure cuff · Working · Today at 8:10");
  });

  it("needs a fix: a recorded error gives one fix button and a plain sentence", () => {
    const v = deviceRowView({ status: "active", lastSyncError: "timeout", lastSyncedAt: "2026-10-17T11:00:00Z" }, now);
    expect(v.state).toBe("needs_fix");
    expect(v.stateLabel).toBe("Needs a quick fix");
    expect(v.lastSynced).toBe("3 days ago");
    expect(v.fixLabel).toBe("Fix this");
    expect(v.explain).toMatch(/quick fix/);
  });

  it("not set up: an unpaired device offers to set it up and has never synced", () => {
    const v = deviceRowView({ status: "unpaired", lastSyncedAt: null }, now);
    expect(v).toMatchObject({ state: "not_set_up", stateLabel: "Not set up", lastSynced: "Not synced yet", fixLabel: "Set it up" });
  });

  it("no state word carries an exclamation mark or red-alert wording", () => {
    for (const status of ["active", "error", "unpaired"]) {
      const v = deviceRowView({ status }, now);
      expect(`${v.stateLabel} ${v.explain} ${v.fixLabel ?? ""}`).not.toMatch(/!|WARNING|danger|urgent/i);
    }
  });

  it("has no audio clip yet, so the words are the whole message", () => {
    expect(deviceRowView({ status: "error" }, now).clipId).toBeNull();
  });
});
