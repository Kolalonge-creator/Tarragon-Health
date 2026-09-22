/**
 * Regression coverage for a bug found while adding the finance reversal
 * row-locking migration (20260922181900): request_type 'journal_reversal'
 * could not previously exist in finance_approval_requests at all (a CHECK
 * constraint silently rejected it), so requestLabel/requestSummary had never
 * been exercised against one. Naively they'd read a manual-journal-shaped
 * payload ({lines, currency, memo}) off a reversal payload
 * ({entry_id, reason}) and render "Manual journal · ₦0" for what is
 * actually a request to reverse a real, material posted entry — the exact
 * kind of decision a maker-checker approval screen exists to make visible.
 * (formatMinor's minimumFractionDigits is 0, so a whole-number amount never
 * shows ".00" — the misleading string this bug actually produces is "₦0".)
 */
import { requestLabel, requestSummary } from "./approvals";
import type { PendingApproval, ApprovalHistoryEntry } from "@/lib/finance/schemas";

describe("requestLabel", () => {
  it("labels each request_type distinctly", () => {
    expect(requestLabel("period_lock")).toBe("Period lock");
    expect(requestLabel("journal_reversal")).toBe("Reversal");
    expect(requestLabel("manual_journal")).toBe("Manual journal");
  });
});

describe("requestSummary", () => {
  const basePending: PendingApproval = {
    id: "req-1",
    request_type: "journal_reversal",
    payload: { entry_id: "entry-1", reason: "duplicate charge" },
    reason: "duplicate charge",
    requested_by_name: "Ada",
    requested_at: "2026-09-18T00:00:00Z",
    is_own_request: false,
    reversal_target: { entry_no: 42, currency: "NGN", amount_minor: 60000000 },
  };

  it("shows the target entry's real amount and number for a reversal request, never a manual-journal reading of its payload", () => {
    const text = requestSummary(basePending);
    expect(text).toContain("entry #42");
    expect(text).toContain("₦600,000");
    expect(text).toContain("duplicate charge");
    // The bug this guards against: falling through to the manual_journal
    // branch, which reads payload.lines/payload.currency (absent on a
    // reversal payload) and renders a misleading zero amount.
    expect(text).not.toContain("₦0");
    expect(text).not.toContain("Journal entry:");
  });

  it("degrades to a clear placeholder, not a crash or a false amount, when the target entry no longer exists (reversal_target absent)", () => {
    const row: PendingApproval = { ...basePending, reversal_target: undefined };
    const text = requestSummary(row);
    expect(text).toContain("no longer exists");
    expect(text).not.toContain("₦0");
  });

  it("degrades the same way when reversal_target is an explicit null -- the actual shape the RPC returns, not just an absent key", () => {
    const row: PendingApproval = { ...basePending, reversal_target: null };
    const text = requestSummary(row);
    expect(text).toContain("no longer exists");
    expect(text).not.toContain("₦0");
  });

  it("still summarises manual_journal and period_lock requests as before", () => {
    const manualJournal: PendingApproval = {
      id: "req-2",
      request_type: "manual_journal",
      payload: {
        currency: "NGN",
        memo: "Q3 accrual",
        lines: [{ debit_minor: 500000, credit_minor: 0 }, { debit_minor: 0, credit_minor: 500000 }],
      },
      reason: "Q3 accrual",
      requested_by_name: "Ada",
      requested_at: "2026-09-18T00:00:00Z",
      is_own_request: false,
    };
    expect(requestSummary(manualJournal)).toBe("Journal entry: ₦5,000 · Q3 accrual");

    const periodLock: ApprovalHistoryEntry = {
      id: "req-3",
      request_type: "period_lock",
      status: "approved",
      payload: { period_month: "2026-08-01" },
      reason: null,
      requested_by_name: "Ada",
      requested_at: "2026-09-18T00:00:00Z",
      reviewed_by_name: "Bello",
      reviewed_at: "2026-09-18T01:00:00Z",
      review_note: null,
      result_entry_id: null,
    };
    expect(requestSummary(periodLock)).toBe("Lock accounting period 2026-08-01");
  });
});
