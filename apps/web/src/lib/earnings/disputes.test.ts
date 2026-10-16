import {
  PAY_STATUS,
  PAY_STATUS_LABEL,
  REASON_CODES,
  REASON_LABEL,
  canDispute,
  describeDisputeError,
  holdDecisionSchema,
  myLinesSchema,
  openDisputeSchema,
  payStatusVariant,
  resolveDisputeSchema,
  statementSchema,
} from "./disputes";
import { pdfNaira } from "./pdf-money";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("describeDisputeError", () => {
  it("turns database codes into plain words", () => {
    expect(describeDisputeError({ message: "dispute_already_open" })).toMatch(/already have a question open/);
    expect(describeDisputeError({ message: "payout_withholding_undecided" })).toMatch(/cannot be sent/);
  });
  it("falls back, and never leaks a raw message", () => {
    expect(describeDisputeError({ message: "duplicate key value violates unique constraint x" })).toBe("Something went wrong. Please try again.");
    expect(describeDisputeError(null, "Custom")).toBe("Custom");
  });
});

describe("labels cover every code the database can return", () => {
  it("has a label for each reason code and each pay status", () => {
    for (const c of REASON_CODES) expect(REASON_LABEL[c].length).toBeGreaterThan(3);
    for (const s of PAY_STATUS) expect(PAY_STATUS_LABEL[s].length).toBeGreaterThan(3);
  });
  it("shows a failed payout in red and a paid one in green", () => {
    expect(payStatusVariant("failed")).toBe("red");
    expect(payStatusVariant("paid")).toBe("green");
    expect(payStatusVariant("pending")).toBe("grey");
  });
});

describe("openDisputeSchema", () => {
  it("accepts a reason code with an optional note", () => {
    expect(openDisputeSchema.safeParse({ ledgerId: uuid, reasonCode: "wrong_amount", requestId: uuid }).success).toBe(true);
  });
  it("refuses a made-up reason and an over-long note", () => {
    expect(openDisputeSchema.safeParse({ ledgerId: uuid, reasonCode: "because", requestId: uuid }).success).toBe(false);
    expect(openDisputeSchema.safeParse({ ledgerId: uuid, reasonCode: "other", requestId: uuid, note: "x".repeat(1001) }).success).toBe(false);
  });
  it("needs the request id that makes a double tap one question", () => {
    expect(openDisputeSchema.safeParse({ ledgerId: uuid, reasonCode: "other", requestId: "nope" }).success).toBe(false);
  });
});

describe("resolveDisputeSchema", () => {
  it("needs a reason of at least ten characters for either answer", () => {
    expect(resolveDisputeSchema.safeParse({ resolution: "rejected", disputeId: uuid, note: "short" }).success).toBe(false);
    expect(resolveDisputeSchema.safeParse({ resolution: "rejected", disputeId: uuid, note: "Checked and it stands" }).success).toBe(true);
  });
  it("a correction needs a direction", () => {
    expect(resolveDisputeSchema.safeParse({ resolution: "adjusted", disputeId: uuid, note: "Added the difference" }).success).toBe(false);
    expect(resolveDisputeSchema.safeParse({ resolution: "adjusted", disputeId: uuid, direction: "add", note: "Added the difference" }).success).toBe(true);
  });
});

describe("holdDecisionSchema", () => {
  it("accepts only release or deny, with a reason", () => {
    expect(holdDecisionSchema.safeParse({ holdId: uuid, decision: "released", note: "Checked with the lead" }).success).toBe(true);
    expect(holdDecisionSchema.safeParse({ holdId: uuid, decision: "paid", note: "Checked with the lead" }).success).toBe(false);
  });
});

describe("reads", () => {
  it("parses a line with a status and refuses an unknown status", () => {
    const line = { id: uuid, kind: "task", amount_kobo: 100, earned_at: "2026-10-01T00:00:00Z", payout_id: null, calculation: {}, pay_status: "pending", dispute_id: null, dispute_state: null, dispute_due_at: null };
    expect(myLinesSchema.safeParse([line]).success).toBe(true);
    expect(myLinesSchema.safeParse([{ ...line, pay_status: "mystery" }]).success).toBe(false);
  });
  it("a line can be questioned unless a question is already open on it", () => {
    expect(canDispute({ dispute_state: null })).toBe(true);
    expect(canDispute({ dispute_state: "rejected" })).toBe(true);
    expect(canDispute({ dispute_state: "open" })).toBe(false);
  });
  it("parses a statement with gross, withholding and net", () => {
    const s = statementSchema.safeParse({
      payout_id: uuid, clinician_name: "A", tin: null, period_start: "2026-10-01", period_end: "2026-10-04", state: "succeeded", reference: "r",
      gross_kobo: 201000, withholding_kobo: 5000, withholding_note: "typed", net_kobo: 196000, lines: [],
    });
    expect(s.success).toBe(true);
  });
});

describe("pdfNaira", () => {
  it("writes integer kobo exactly, with no floating point", () => {
    expect(pdfNaira(0)).toBe("NGN 0.00");
    expect(pdfNaira(5)).toBe("NGN 0.05");
    expect(pdfNaira(201000)).toBe("NGN 2,010.00");
    expect(pdfNaira(123456789)).toBe("NGN 1,234,567.89");
  });
  it("keeps the sign of a correction that takes money back", () => {
    expect(pdfNaira(-5000)).toBe("-NGN 50.00");
  });
});
