/** @jest-environment jsdom */
/**
 * Where a Member sees and stops automatic renewal: hidden when there is nothing true to say, one tap to cancel, the paid year kept, and
 * never the card's authorization code.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { RenewalCard } from "./renewal-card";

let renewal: { data: unknown };
const mutateAsync = jest.fn();
jest.mock("@/lib/queries/commerce", () => ({
  useMyRenewal: () => renewal,
  useCancelRenewal: () => ({ mutateAsync, isPending: false }),
}));

const ON = { enabled: true, has_membership: true, auto_renew: true, ends_at: "2027-10-26T00:00:00Z", amount_kobo: 12_900_000, card: { brand: "visa", last4: "4081", exp_month: "12", exp_year: "2030" } };
beforeEach(() => { renewal = { data: ON }; mutateAsync.mockReset(); mutateAsync.mockResolvedValue({}); });
afterEach(cleanup);

describe("RenewalCard", () => {
  it("shows nothing without a Membership, without information, or when the switch is off and nothing is renewing", () => {
    for (const data of [null, undefined, { ...ON, has_membership: false }, { ...ON, enabled: false, auto_renew: false }]) {
      renewal = { data };
      const { container } = render(<RenewalCard locale="en" />);
      expect(container.textContent).toBe("");
      cleanup();
    }
  });

  it("when renewing: the date, the amount, the last four digits, the up-to-3-days timing and what cancelling keeps", () => {
    render(<RenewalCard locale="en" />);
    const text = document.body.textContent!;
    expect(text).toMatch(/renews on/);
    expect(text).toMatch(/card ending 4081/);
    expect(text).toMatch(/₦129,000/);
    expect(text).toMatch(/up to 3 days before/);
    expect(text).toMatch(/You keep your Membership until/);
    expect(text).toMatch(/delete the saved card/);
    expect(screen.getByRole("button", { name: "Cancel renewal" })).toBeTruthy();
  });

  it("cancelling is one tap, says the year is kept, and hides the button", async () => {
    render(<RenewalCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel renewal" })));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toMatch(/Renewal is off\. Your Membership runs until/);
    expect(screen.queryByRole("button", { name: "Cancel renewal" })).toBeNull();
  });

  it("a failed cancel says so and leaves the button, so the person can try again", async () => {
    mutateAsync.mockRejectedValue(new Error("x"));
    render(<RenewalCard locale="en" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel renewal" })));
    expect(screen.getByRole("alert").textContent).toMatch(/could not cancel renewal/);
    expect(screen.getByRole("button", { name: "Cancel renewal" })).toBeTruthy();
  });

  it("switch on but this person is not renewing: says it ends on its date and how to renew by itself next time", () => {
    renewal = { data: { ...ON, auto_renew: false, card: null } };
    render(<RenewalCard locale="en" />);
    expect(document.body.textContent).toMatch(/does not renew by itself\. It ends on/);
    expect(document.body.textContent).toMatch(/tick the renewal box/);
    expect(screen.queryByRole("button", { name: "Cancel renewal" })).toBeNull();
  });

  it("never renders anything that looks like an authorization code", () => {
    renewal = { data: { ...ON, authorization_code: "AUTH_secret" } };
    render(<RenewalCard locale="en" />);
    expect(document.body.textContent).not.toMatch(/AUTH_/);
  });

  it("has no accessibility violations", async () => {
    await expectNoA11yViolations(<RenewalCard locale="en" />);
  });
});
