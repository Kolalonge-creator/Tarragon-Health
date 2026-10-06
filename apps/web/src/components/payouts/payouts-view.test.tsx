/** @jest-environment node */
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import type { PayoutRow } from "@/lib/payouts/model";

const row = (over: Partial<PayoutRow>): PayoutRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  clinician_id: "22222222-2222-4222-8222-222222222222",
  clinician_name: "Dr Ada",
  period_start: "2026-09-28",
  period_end: "2026-10-04",
  amount_kobo: 470000,
  line_count: 3,
  state: "draft",
  fee_schedule_versions: [2],
  prepared_by: "33333333-3333-4333-8333-333333333333",
  prepared_by_name: "Ops Ngozi",
  prepared_at: "2026-10-05T08:00:00Z",
  approved_by_name: null,
  approved_at: null,
  approval_note: null,
  cancel_reason: null,
  can_approve: true,
  ...over,
});

let payouts: PayoutRow[] = [];
let ok = true;
let guardOn: boolean | null = false;
jest.mock("@/lib/payouts/load", () => ({
  loadPayouts: async () => (ok ? { ok: true, data: payouts } : { ok: false }),
  loadUnpaid: async () => ({ ok: true, data: [{ clinician_id: "22222222-2222-4222-8222-222222222222", full_name: "Dr Ada", lines: 3, unpaid_kobo: 470000, waiting_for_correction: 1 }] }),
  loadPayoutsGuard: async () => guardOn,
}));
jest.mock("@/lib/payouts/actions", () => ({ preparePayoutsAction: async () => undefined, approvePayoutAction: async () => undefined, cancelPayoutAction: async () => undefined }));

import { PayoutsView } from "./payouts-view";

const html = async (viewer: "admin" | "ops", extra: { notice?: string } = {}) => renderToStaticMarkup(await PayoutsView({ viewer, locale: "en", ...extra }));

describe("PayoutsView", () => {
  it("shows Approve to the admin only on a draft the database says they may approve", async () => {
    payouts = [row({ can_approve: true })];
    expect(await html("admin")).toContain(">Approve<");
  });
  it("never shows Approve on a draft the admin prepared themselves, and says why", async () => {
    payouts = [row({ can_approve: false })];
    const h = await html("admin");
    expect(h).not.toContain(">Approve<");
    expect(h).toContain("a second person must approve it");
  });
  it("never shows Approve on the ops door, even when the row says approvable", async () => {
    payouts = [row({ can_approve: true })];
    const h = await html("ops");
    expect(h).not.toContain(">Approve<");
    expect(h).toContain("Prepare drafts");
    expect(h).toContain("Unpaid earnings");
  });
  it("has no send or mark-sent control anywhere, and says sending is off", async () => {
    payouts = [row({ state: "approved", can_approve: false })];
    const h = await html("admin");
    expect(h.toLowerCase()).not.toContain("mark sent");
    expect(h.toLowerCase()).not.toMatch(/<button[^>]*>\s*(send|mark)/);
    expect(h).toContain("Sending payouts is switched off");
  });
  it("treats an unreadable guard as off", async () => {
    guardOn = null;
    payouts = [];
    expect(await html("admin")).toContain("Treat sending as off");
    guardOn = false;
  });
  it("an approved payout offers cancel to the admin, not to ops", async () => {
    payouts = [row({ state: "approved", approved_by_name: "Founder", approval_note: "Checked against the ledger", can_approve: false })];
    expect(await html("admin")).toContain("Cancel payout");
    expect(await html("ops")).not.toContain("Cancel payout");
  });
  it("a failed load says so and is not an empty list", async () => {
    ok = false;
    const h = await html("admin");
    ok = true;
    expect(h).toContain("We could not load this");
    expect(h).not.toContain("No payouts yet");
  });
  it("shows only the fixed notice text for a known token and nothing for an unknown one", async () => {
    payouts = [];
    expect(await html("admin", { notice: "same_person" })).toContain("you cannot approve it");
    expect(await html("admin", { notice: "<script>" })).not.toContain("<script>");
  });
});
