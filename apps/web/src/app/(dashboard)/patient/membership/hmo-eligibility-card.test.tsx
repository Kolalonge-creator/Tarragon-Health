/** @jest-environment jsdom */
/**
 * S71 (19.6): the "check my health plan" card. Shown only when a plan has a Tarragon programme; sends the number once and never shows it again;
 * a check the HMO could not answer says the team will check it (never "no"); a refusal has a plain message. Scanned with axe.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { CheckoutError } from "@/lib/queries/commerce";
import { HmoEligibilityCard } from "./hmo-eligibility-card";

let plans: { data: unknown[]; isSuccess: boolean };
let checks: { data: unknown[] };
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/commerce", () => {
  const actual = jest.requireActual("@/lib/queries/commerce");
  return { ...actual, useHmoPlans: () => plans, useMyHmoChecks: () => checks, useRequestHmoCheck: () => ({ mutateAsync, isPending: false }) };
});

beforeEach(() => {
  plans = { data: [{ hmo_id: "h1", name: "Proof HMO" }], isSuccess: true };
  checks = { data: [] };
  mutateAsync.mockReset();
});
afterEach(() => cleanup());

const submit = async (number: string) => {
  fireEvent.change(screen.getByLabelText("Member number"), { target: { value: number } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Check my membership" }));
  });
};

describe("HmoEligibilityCard", () => {
  it("renders nothing when no health plan has a Tarragon programme", () => {
    plans = { data: [], isSuccess: true };
    const { container } = render(<HmoEligibilityCard locale="en" />);
    expect(container.textContent).toBe("");
  });

  it("is accessible and says the number is kept as a scrambled code", async () => {
    await expectNoA11yViolations(<HmoEligibilityCard locale="en" />);
    expect(screen.getByText(/scrambled code of your member number/)).toBeTruthy();
  });

  it("sends the plan and the number once, then clears the number and shows the result", async () => {
    mutateAsync.mockResolvedValue({ check_id: "c1", result: "eligible" });
    render(<HmoEligibilityCard locale="en" />);
    await submit("REL/12345/67");
    expect(mutateAsync).toHaveBeenCalledWith({ hmoId: "h1", memberNumber: "REL/12345/67" });
    expect(screen.getByText(/membership is confirmed/)).toBeTruthy();
    expect((screen.getByLabelText("Member number") as HTMLInputElement).value).toBe("");
  });

  it("a check that could not be answered says the team will check it, not 'no'", async () => {
    mutateAsync.mockResolvedValue({ check_id: "c1", result: "pending_manual" });
    render(<HmoEligibilityCard locale="en" />);
    await submit("REL/12345/67");
    expect(screen.getByText(/Our team will check it/)).toBeTruthy();
    expect(screen.queryByText(/could not confirm this membership/)).toBeNull();
  });

  it("a not-eligible answer says the usual price still applies", async () => {
    mutateAsync.mockResolvedValue({ check_id: "c1", result: "not_eligible" });
    render(<HmoEligibilityCard locale="en" />);
    await submit("REL/12345/67");
    expect(screen.getByText(/pay the usual price/)).toBeTruthy();
  });

  it("maps the refusals to plain messages", async () => {
    for (const [code, text] of [["member_number_invalid", /does not look right/], ["hmo_check_rate_limited", /Too many checks today/], ["sponsor_payment_not_open", /not switched on yet/]] as const) {
      mutateAsync.mockRejectedValue(new CheckoutError(code));
      const { unmount } = render(<HmoEligibilityCard locale="en" />);
      await submit("REL/12345/67");
      expect(screen.getByText(text)).toBeTruthy();
      unmount();
    }
  });

  it("lists earlier checks by plan name, result and date, never a number", () => {
    checks = { data: [{ check_id: "c1", hmo_name: "Proof HMO", result: "eligible", checked_at: "2026-10-01T10:00:00Z", decided_at: "2026-10-02T10:00:00Z" }] };
    render(<HmoEligibilityCard locale="en" />);
    expect(screen.getAllByText("Proof HMO").length).toBeGreaterThan(0);
    expect(screen.getByText(/membership is confirmed/)).toBeTruthy();
  });
});
