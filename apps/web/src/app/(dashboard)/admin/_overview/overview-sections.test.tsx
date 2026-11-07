/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { resolvePeriod, type Overview } from "@/lib/admin-overview/model";
import { CommercialSplit, OverviewKpis, PeriodPicker, SystemHealth } from "./overview-sections";

const win = (o: Partial<Overview["current"]>): Overview["current"] => ({
  registrations: 0, memberships_started: 0, started_by_source: {}, memberships_ended: 0, collected_kobo: 0, collected_count: 0,
  refunded_kobo: 0, refunded_count: 0, failed_payments: 0, notifications_sent: 0, notifications_failed: 0, ...o,
});
const overview: Overview = {
  window: { from: "a", to: "b", previous_from: "c", previous_to: "a" },
  current: win({ registrations: 12, memberships_started: 3, collected_kobo: 30_000_000, refunded_kobo: 10_000_000, failed_payments: 4, notifications_sent: 200, notifications_failed: 5 }),
  previous: win({ registrations: 10, memberships_started: 0, collected_kobo: 20_000_000, failed_payments: 2 }),
  snapshot: { computed_at: "t", registered_patients: 100, active_memberships: 7, active_by_source: { purchase: 5, voucher: 2 }, free_patients: 93, ending_next_30d: 1 },
};
const period = resolvePeriod("30d", new Date("2026-11-07T02:30:00Z"));

describe("homepage overview sections", () => {
  it("draws every period figure with its comparison, and is accessible", async () => {
    await expectNoA11yViolations(<OverviewKpis overview={overview} period={period} />);
    expect(screen.getByRole("heading", { name: "Last 30 days" })).toBeTruthy();
    expect(screen.getByText("↑ 20% on the 30 days before (was 10)")).toBeTruthy();
    // From zero: the old figure, not an infinite percentage.
    expect(screen.getByText("↑ from 0 in the 30 days before")).toBeTruthy();
    // Net collected is collected minus refunded.
    expect(screen.getByText("Net collected", { selector: "p" }).closest("a")?.textContent).toContain("200,000");
  });

  it("draws a rise in failed payments in the warning colour, not the reassuring one", () => {
    render(<OverviewKpis overview={overview} period={period} />);
    const tile = screen.getByText("Failed payments", { selector: "p" }).closest("a") as HTMLElement;
    const line = Array.from(tile.querySelectorAll("*")).find((el) => el.textContent === "↑ 100% on the 30 days before (was 2)") as HTMLElement;
    expect(line.className).toContain("text-sprout-gold");
  });

  it("splits Free and Membership by who pays, with shares of all registered patients", () => {
    render(<CommercialSplit overview={overview} />);
    expect(screen.getByText("Free").parentElement?.textContent).toContain("93 (93%)");
    expect(screen.getByText("Member: sponsored by someone (care voucher)").parentElement?.textContent).toContain("2 (2%)");
    expect(screen.getByRole("link", { name: "1 Membership end in the next 30 days" })).toBeTruthy();
  });

  it("shows each dependency's state with the evidence it rests on", () => {
    render(
      <SystemHealth
        checkedAt={new Date("2026-11-07T02:30:00Z")}
        lines={[
          { name: "Supabase", line: { state: "operational", evidence: "Answered a live check in 40 ms" } },
          { name: "Paystack", line: { state: "unknown", evidence: "A key is set, but nothing has checked that the provider answers" } },
        ]}
      />
    );
    expect(screen.getByText("Paystack").parentElement?.textContent).toContain("A key is set");
    expect(screen.getByText("Unknown")).toBeTruthy();
  });

  it("marks the chosen period", () => {
    render(<PeriodPicker current="7d" />);
    expect(screen.getByRole("link", { name: "Last 7 days" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: "Year to date" }).getAttribute("href")).toBe("/admin?period=ytd");
  });
});
