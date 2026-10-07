import { approvalRowsSchema, buildApprovalModel, truncatedTotal, type ApprovalRow } from "./approvals";

const row = (over: Partial<ApprovalRow> = {}): ApprovalRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  period_start: "2026-09-28",
  period_end: "2026-10-04",
  amount_kobo: 180000,
  line_count: 3,
  clinician_name: "Ada Okafor",
  bank_ready: true,
  state: "draft",
  created_at: "2026-10-05T07:05:00Z",
  is_mine: false,
  total_waiting: 1,
  ...over,
});

describe("payout approval page model", () => {
  it("allows approval only when approval is on and the bank is verified", () => {
    expect(buildApprovalModel([row()], true)[0]).toMatchObject({ canApprove: true, blockedReason: null });
    expect(buildApprovalModel([row({ bank_ready: false })], true)[0]).toMatchObject({ canApprove: false, blockedReason: "no_bank" });
  });
  it("disables every button when approval is switched off", () => {
    const m = buildApprovalModel([row(), row({ bank_ready: false })], false);
    expect(m.every((r) => !r.canApprove && r.blockedReason === "guard_off")).toBe(true);
  });
  it("blocks the caller's own draft with its own reason, but guard off still wins", () => {
    expect(buildApprovalModel([row({ is_mine: true })], true)[0]).toMatchObject({ canApprove: false, blockedReason: "mine" });
    expect(buildApprovalModel([row({ is_mine: true })], false)[0]).toMatchObject({ blockedReason: "guard_off" });
    expect(buildApprovalModel([row({ is_mine: true, bank_ready: false })], true)[0].blockedReason).toBe("mine");
  });
  it("reports a total only when more drafts wait than are shown", () => {
    expect(truncatedTotal([row({ total_waiting: 1 })])).toBeNull();
    expect(truncatedTotal([])).toBeNull();
    expect(truncatedTotal([row({ total_waiting: 250 }), row({ total_waiting: 250 })])).toBe(250);
  });
  it("parses what the database returns and rejects a malformed row", () => {
    expect(approvalRowsSchema.safeParse([row()]).success).toBe(true);
    expect(approvalRowsSchema.safeParse([{ ...row(), amount_kobo: 1.5 }]).success).toBe(false);
    expect(approvalRowsSchema.safeParse([{ ...row(), is_mine: undefined }]).success).toBe(false);
  });
});
