import { parseAccessLog, parseDeletionStatus } from "./cycle-privacy";

const counts = { menstrual_cycles: 3, menstrual_daily_logs: 10, menopause_logs_deleted: 1, menopause_logs_sealed: 2, reminders: 4 };

describe("cycle privacy parsers (mobile)", () => {
  it("reads a good access list and an empty one (an empty list is not a failure)", () => {
    expect(parseAccessLog([{ at: "2026-10-07T10:00:00Z", result: "success", reader: "Dr A" }])).toHaveLength(1);
    expect(parseAccessLog([])).toEqual([]);
  });
  it("a malformed reply is a failure, never read as nobody having looked", () => {
    for (const bad of [null, undefined, {}, [{ at: 1 }], [{ at: "x", result: "maybe", reader: "y" }], "x"]) expect(parseAccessLog(bad)).toBe("failed");
  });
  it("reads a deletion status with and without a pending request or a receipt", () => {
    expect(parseDeletionStatus({ pending: null, last_receipt: null, counts })).toEqual({ pending: null, lastReceipt: null, counts });
    const full = parseDeletionStatus({
      pending: { execute_after: "2026-10-21T00:00:00Z", requested_at: "2026-10-07T00:00:00Z" },
      last_receipt: { completed_at: "2026-09-01T00:00:00Z", receipt: { menstrual_cycles_deleted: 1, menstrual_daily_logs_deleted: 2, menopause_logs_deleted: 3, menopause_logs_sealed_kept: 4, reminders_deleted: 5 } },
      counts,
    });
    expect(full).not.toBe("failed");
  });
  it("fails closed on a bad deletion status", () => {
    for (const bad of [null, {}, { pending: null, counts }, { pending: null, last_receipt: null, counts: { ...counts, reminders: "4" } }, { pending: { execute_after: 1 }, last_receipt: null, counts }]) {
      expect(parseDeletionStatus(bad)).toBe("failed");
    }
  });
});
