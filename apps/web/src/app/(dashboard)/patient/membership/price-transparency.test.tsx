/** @jest-environment jsdom */
/**
 * WP1 pricing transparency: the "not included" list (a price from the price book or "Ask us", never a made-up number), the monthly equivalent
 * (always with "billed once a year"; nothing for Free or a covered price) and the price-change card (calm, says nothing is charged).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { MonthlyEquivalent, NotIncludedList, PriceChangeCard } from "./price-transparency";
import { showMonthlyEquivalent } from "./monthly-switch";
import { IncludedView } from "./[code]/included-view";

const ITEM = {
  code: "membership_annual", kind: "membership" as const, name_key: "catalog.membership_annual.name", description_key: "catalog.membership_annual.description",
  included_keys: ["catalog.membership_annual.incl.1"], duration_days: 365, uses: null, amount_kobo: 8_400_000, components: {},
};

describe("NotIncludedList", () => {
  const entries = [
    { labelKey: "catalog.notincl.medicines", extraCode: null, amountKobo: null },
    { labelKey: "catalog.consultation_single.name", extraCode: "consultation_single", amountKobo: 1_500_000 },
    { labelKey: "catalog.lab_panel_standard.name", extraCode: "lab_panel_standard", amountKobo: null },
  ];

  it("shows words-only entries without a price, priced extras with their price and an unpriced extra as Ask us", async () => {
    render(<NotIncludedList entries={entries} locale="en" id="x" />);
    expect(screen.getByRole("heading", { name: "What is not included" })).toBeTruthy();
    expect(screen.getByText(/You take your prescription to any pharmacy/)).toBeTruthy();
    expect(screen.getByText("₦15,000")).toBeTruthy();
    expect(screen.getByText("Ask us")).toBeTruthy();
    expect(screen.getByLabelText("A lab test package: ask us for the price")).toBeTruthy();
    expect(screen.getByText(/sold separately/)).toBeTruthy();
    cleanup();
    await expectNoA11yViolations(<NotIncludedList entries={entries} locale="en" id="x" />);
  });

  it("shows nothing when the list is empty or every key is unknown, never a raw key", () => {
    const { container } = render(<NotIncludedList entries={[]} locale="en" id="x" />);
    expect(container.textContent).toBe("");
    cleanup();
    const unknown = render(<NotIncludedList entries={[{ labelKey: "catalog.future.name", extraCode: "future", amountKobo: 5 }]} locale="en" id="x" />);
    expect(unknown.container.textContent).toBe("");
  });

  it("says nothing about being sold separately when only words are listed", () => {
    render(<NotIncludedList entries={[entries[0]!]} locale="en" id="x" />);
    expect(screen.queryByText(/sold separately/)).toBeNull();
  });
});

describe("MonthlyEquivalent", () => {
  it("states the monthly figure and that it is billed once a year in one sentence", () => {
    render(<MonthlyEquivalent amountDueKobo={8_400_000} durationDays={365} locale="en" enabled />);
    expect(screen.getByText("About ₦7,000 a month. Billed once a year, not monthly.")).toBeTruthy();
  });

  it("shows nothing at all while it is switched off (the default)", () => {
    const { container } = render(<MonthlyEquivalent amountDueKobo={8_400_000} durationDays={365} locale="en" />);
    expect(container.textContent).toBe("");
  });

  it("shows nothing for Free, a covered price, or an item that is not a year long", () => {
    for (const [amount, days] of [[0, 365], [8_400_000, 90], [8_400_000, null]] as const) {
      const { container } = render(<MonthlyEquivalent amountDueKobo={amount} durationDays={days} locale="en" enabled />);
      expect(container.textContent).toBe("");
      cleanup();
    }
  });
});

describe("PriceChangeCard", () => {
  const notice = { itemCode: "membership_annual", nameKey: "catalog.membership_annual.name", paidListKobo: 8_400_000, newKobo: 12_900_000, newFrom: "2026-12-01T00:00:00Z", endsAt: "2027-03-10T10:00:00Z" };

  it("tells the person calmly: the old and new price, that nothing changes until it ends, and that nothing is charged by itself", async () => {
    render(<PriceChangeCard notices={[notice]} locale="en" />);
    expect(screen.getByRole("heading", { name: "A price is changing" })).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).toContain("₦84,000");
    expect(text).toContain("₦129,000");
    expect(text).toMatch(/already paid for, so nothing changes/);
    expect(text).toMatch(/Nothing is charged by itself/);
    expect(text).not.toMatch(/warning|urgent|act now|last chance|hurry/i);
    cleanup();
    await expectNoA11yViolations(<PriceChangeCard notices={[notice]} locale="en" />);
  });

  it("shows nothing when there is no notice", () => {
    const { container } = render(<PriceChangeCard notices={[]} locale="en" />);
    expect(container.textContent).toBe("");
  });
});

describe("the switch", () => {
  it("is off in the shipped configuration", () => {
    expect(showMonthlyEquivalent()).toBe(false);
  });
});

describe("IncludedView with the transparency lines", () => {
  it("puts the monthly line under the price and the not-included list on the page", () => {
    render(<IncludedView item={ITEM} yourPriceKobo={8_400_000} locale="en" notIncluded={[{ labelKey: "catalog.notincl.medicines", extraCode: null, amountKobo: null }]} showMonthly />);
    expect(screen.getByText("About ₦7,000 a month. Billed once a year, not monthly.")).toBeTruthy();
    expect(screen.getByText("What is not included")).toBeTruthy();
  });

  it("shows no monthly line while the switch is off", () => {
    render(<IncludedView item={ITEM} yourPriceKobo={8_400_000} locale="en" />);
    expect(screen.queryByText(/a month/)).toBeNull();
  });

  it("shows no monthly line when the person's own price is zero (covered)", () => {
    render(<IncludedView item={ITEM} yourPriceKobo={0} locale="en" showMonthly />);
    expect(screen.queryByText(/a month/)).toBeNull();
  });
});
