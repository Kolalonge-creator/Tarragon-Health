/** @jest-environment jsdom */
/**
 * The "what is included" page (S73, module 20.6): what you get, what it costs, how it ends and how to ask for a refund, in plain words.
 * Shows the person's own price when it differs from the usual one, shows nothing for a copy key it does not know, and says so plainly
 * when the item is not on sale. Scanned with axe.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { IncludedView } from "./included-view";

const ITEM = {
  code: "membership_annual", kind: "membership" as const, name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description",
  included_keys: ["catalog.membership_annual.incl.1", "catalog.membership_annual.incl.2"], duration_days: 365, uses: null, amount_kobo: 10_000_000, components: {},
};

describe("IncludedView", () => {
  it("names the item, lists what is included, gives the price, the length, no renewal and the refund route", async () => {
    render(<IncludedView item={ITEM} yourPriceKobo={10_000_000} locale="en" />);
    expect(screen.getByRole("heading", { name: "Tarragon Membership" })).toBeTruthy();
    expect(screen.getByText(/A video call with your care team every month/)).toBeTruthy();
    expect(screen.getByText("₦100,000")).toBeTruthy();
    expect(screen.getByText("It lasts 365 days from the day you pay.")).toBeTruthy();
    expect(screen.getByText(/does not renew by itself/)).toBeTruthy();
    expect(screen.getByText(/ask for a refund/)).toBeTruthy();
    expect(screen.queryByText("Your price")).toBeNull();
    cleanup();
    await expectNoA11yViolations(<IncludedView item={ITEM} yourPriceKobo={10_000_000} locale="en" />);
  });

  it("shows the person's own price next to the usual one when they differ", () => {
    render(<IncludedView item={ITEM} yourPriceKobo={9_000_000} locale="en" />);
    expect(screen.getByText("Usual price")).toBeTruthy();
    expect(screen.getByText("Your price")).toBeTruthy();
    expect(screen.getByText("₦90,000")).toBeTruthy();
  });

  it("shows nothing for a copy key this build does not know, never the raw key", () => {
    render(<IncludedView item={{ ...ITEM, name_key: "catalog.future.name", included_keys: ["catalog.future.incl.1"] }} yourPriceKobo={null} locale="en" />);
    expect(screen.queryByText(/catalog\.future/)).toBeNull();
  });

  it("says plainly when the item is not on sale, with a way back", () => {
    render(<IncludedView item={null} yourPriceKobo={null} locale="en" />);
    expect(screen.getByRole("status").textContent).toBe("This is not available right now.");
    expect(screen.getByRole("link", { name: "Back to Membership" }).getAttribute("href")).toBe("/patient/membership");
  });
});
