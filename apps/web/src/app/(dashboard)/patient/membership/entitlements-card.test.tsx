/** @jest-environment jsdom */
/** S72 (19.12): the entitlements view says what the person has, where it came from, and what is left, in plain words. Never money. */
import { cleanup, render, screen } from "@testing-library/react";
import { parseEntitlements } from "@tarragon/commerce";
import { expectNoA11yViolations } from "@/test/a11y";
import { EntitlementsCard } from "./entitlements-card";

const row = (o: Record<string, unknown>) => ({ id: "e1", kind: "consultation_credit", state: "active", starts_at: "2026-10-01T00:00:00Z", ends_at: null, remaining_uses: null, name_key: "catalog.consultation_single.name", days_left: null, source: "paid", sponsor_name: null, part_covered: false, ...o });
let rows: unknown;
jest.mock("@/lib/queries/commerce", () => ({ useMyEntitlements: () => ({ data: parseEntitlements(rows) }) }));
afterEach(cleanup);

describe("EntitlementsCard", () => {
  it("says '3 consultations remaining' and where it came from", async () => {
    rows = [row({ remaining_uses: 3 })];
    await expectNoA11yViolations(<EntitlementsCard locale="en" />);
    expect(screen.getByText("3 consultations remaining")).toBeTruthy();
    expect(screen.getByText("You bought this")).toBeTruthy();
  });
  it("says 'valid for 60 more days' for a bounded item", () => {
    rows = [row({ kind: "lab_panel", days_left: 60, name_key: "catalog.lab_panel_standard.name" })];
    render(<EntitlementsCard locale="en" />);
    expect(screen.getByText("valid for 60 more days")).toBeTruthy();
  });
  it("names a sponsor, a supporter and the Community Access Fund in their own words, and never shows a price or a balance", () => {
    rows = [
      row({ id: "a", source: "sponsor", sponsor_name: "Acme Ltd", remaining_uses: 1 }),
      row({ id: "b", source: "supporter", kind: "membership", days_left: 300 }),
      row({ id: "c", source: "access_fund", kind: "lab_panel", days_left: 20, part_covered: true }),
    ];
    const { container } = render(<EntitlementsCard locale="en" />);
    expect(screen.getByText("Covered by Acme Ltd")).toBeTruthy();
    expect(screen.getByText("Paid for by someone who cares about you")).toBeTruthy();
    expect(screen.getByText("From the Community Access Fund")).toBeTruthy();
    expect(screen.getByText("Part of the cost was covered for you")).toBeTruthy();
    expect(container.textContent).not.toMatch(/₦|balance|credit/i);
  });
  it("an expired item says only that it ended", () => {
    rows = [row({ state: "expired", remaining_uses: 2, days_left: 4 })];
    render(<EntitlementsCard locale="en" />);
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.queryByText(/remaining/)).toBeNull();
  });
  it("says there is nothing yet when there is nothing", () => {
    rows = [];
    render(<EntitlementsCard locale="en" />);
    expect(screen.getByText(/Nothing active right now/)).toBeTruthy();
  });
});
