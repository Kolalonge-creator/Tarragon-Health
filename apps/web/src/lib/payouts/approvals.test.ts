import { approvalRowsSchema, buildApprovalModel, type ApprovalRow } from "./approvals";

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
  it("parses what the database returns and rejects a malformed row", () => {
    expect(approvalRowsSchema.safeParse([row()]).success).toBe(true);
    expect(approvalRowsSchema.safeParse([{ ...row(), amount_kobo: 1.5 }]).success).toBe(false);
  });
});
