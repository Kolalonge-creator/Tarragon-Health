import { describe, expect, it } from "@jest/globals";
import { deletionDueAt, retentionRules, TRACKER_DELETION_SCOPES } from "./retention";

describe("retention rules", () => {
  it("the scopes in the configuration are exactly the scopes the database knows", () => {
    expect([...retentionRules().scopes].sort()).toEqual([...TRACKER_DELETION_SCOPES].sort());
  });
  it("the grace window comes from configuration", () => {
    const r = retentionRules();
    expect(r.graceDays).toBe(7);
    expect(r.sealedRetentionYears).toBe(8);
    expect(deletionDueAt(new Date("2026-10-07T10:00:00Z")).toISOString()).toBe("2026-10-14T10:00:00.000Z");
    expect(deletionDueAt(new Date("2026-10-07T10:00:00Z"), 1).toISOString()).toBe("2026-10-08T10:00:00.000Z");
  });
});
