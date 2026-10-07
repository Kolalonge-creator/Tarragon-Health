import { parseAccessLog, parseDeletionStatus } from "./privacy-parsers";

describe("privacy RPC parsers", () => {
  it("reads a good access list, and an empty one is an empty list (not a failure)", () => {
    expect(parseAccessLog([{ at: "2026-10-07T10:00:00Z", result: "success", reader: "Dr A" }])).toHaveLength(1);
    expect(parseAccessLog([])).toEqual([]);
  });
  it("a malformed reply is a failure, never read as nobody having looked", () => {
    expect(parseAccessLog(null)).toBe("failed");
    expect(parseAccessLog({ rows: [] })).toBe("failed");
    expect(parseAccessLog([{ at: 1 }])).toBe("failed");
    expect(parseAccessLog([{ at: "x", result: "maybe", reader: "y" }])).toBe("failed");
  });
  it("reads a deletion status and fails closed on a bad one", () => {
    const counts = { menstrual_cycles: 3, menstrual_daily_logs: 10, menopause_logs_deleted: 1, menopause_logs_sealed: 2, reminders: 4 };
    const ok = parseDeletionStatus({ pending: null, last_receipt: null, counts });
    expect(ok).toEqual({ pending: null, lastReceipt: null, counts });
    expect(parseDeletionStatus({ pending: null, counts })).toBe("failed");
    expect(parseDeletionStatus(undefined)).toBe("failed");
  });
});
