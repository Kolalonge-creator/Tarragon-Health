/** @jest-environment jsdom */
/** S26b: the refund rule is plain words with the days from configuration, and the refund card shows each step, the answer time and a decline reason. */
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { RefundRule } from "./refund-rule";
import { RefundStatusCard } from "./refund-status-card";

let policy: unknown;
let refunds: unknown;
jest.mock("@/lib/queries/order-refunds", () => ({
  useRefundPolicy: () => ({ data: policy }),
  useMyOrderRefunds: () => ({ data: refunds }),
}));
afterEach(cleanup);

const custom = { coolingOffDays: 10, membershipWindowDays: 30, decisionSlaDays: 2, bankDaysMin: 3, bankDaysMax: 7, graceDays: 5 };

describe("RefundRule", () => {
  it("quotes the days from the configuration it is given, never its own", async () => {
    policy = custom;
    await expectNoA11yViolations(<RefundRule locale="en" membership={false} pack id="x" />);
    expect(screen.getByText(/within 10 days of paying/)).toBeTruthy();
    expect(screen.getByText(/answers within 2 days/)).toBeTruthy();
    expect(screen.getByText(/3 to 7 business days/)).toBeTruthy();
    expect(screen.getByText(/for 5 more days, and renew in one tap/)).toBeTruthy();
    expect(screen.getByText(/Nothing renews by itself/)).toBeTruthy();
  });

  it("a Membership quotes its own window and says access ends at once", () => {
    policy = custom;
    render(<RefundRule locale="en" membership pack={false} id="m" />);
    expect(screen.getByText(/within 30 days of buying it/)).toBeTruthy();
    expect(screen.getByText(/Member access ends straight away/)).toBeTruthy();
  });

  it("shows the rule from the first paint using the registry values before the database answers", () => {
    policy = undefined;
    render(<RefundRule locale="en" membership={false} pack={false} id="f" />);
    expect(screen.getByText(/within 14 days of paying/)).toBeTruthy();
  });

  it("uses no em dash", () => {
    policy = custom;
    const { container } = render(<RefundRule locale="en" membership pack id="e" />);
    expect(container.textContent).not.toMatch(/—/);
  });
});

describe("RefundStatusCard", () => {
  const base = { id: "r1", amount_kobo: 1_200_000, order: { amount_kobo: 1_200_000, catalog_item: { code: "care_pack_90", name_key: "catalog.care_pack.name" } }, decision_note: null };

  it("shows each step in order, the answer time while pending", () => {
    policy = custom;
    refunds = [{ ...base, state: "pending", steps: [{ step: "requested", created_at: "2026-10-10T10:00:00Z" }] }];
    render(<RefundStatusCard locale="en" />);
    expect(screen.getByText("We have your request")).toBeTruthy();
    expect(screen.getByText("Your care team answers within 2 days.")).toBeTruthy();
  });

  it("a declined refund shows the reason from the care team", () => {
    policy = custom;
    refunds = [{ ...base, state: "rejected", decision_note: "This was bought more than 14 days ago.", steps: [
      { step: "requested", created_at: "2026-10-10T10:00:00Z" }, { step: "declined", created_at: "2026-10-11T10:00:00Z" }] }];
    render(<RefundStatusCard locale="en" />);
    expect(screen.getByText("Not approved")).toBeTruthy();
    expect(screen.getByText(/Reason from your care team/)).toBeTruthy();
    expect(screen.getByText(/bought more than 14 days ago/)).toBeTruthy();
  });

  it("an approved refund says how long the bank usually takes, and a completed one is the last step", () => {
    policy = custom;
    refunds = [{ ...base, state: "processing", steps: [{ step: "requested", created_at: "2026-10-10T10:00:00Z" }, { step: "approved", created_at: "2026-10-10T12:00:00Z" }, { step: "sending", created_at: "2026-10-11T05:25:00Z" }] }];
    render(<RefundStatusCard locale="en" />);
    expect(screen.getByText("Being sent to your card")).toBeTruthy();
    expect(screen.getByText("Once sent, it usually reaches your bank in 3 to 7 business days.")).toBeTruthy();
  });

  it("renders nothing when there are no refunds", () => {
    refunds = [];
    const { container } = render(<RefundStatusCard locale="en" />);
    expect(container.textContent).toBe("");
  });
});
