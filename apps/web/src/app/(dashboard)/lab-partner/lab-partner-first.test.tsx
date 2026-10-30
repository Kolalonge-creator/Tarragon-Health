/** @jest-environment jsdom */
type Q = { data?: unknown; isError?: boolean };
let stats: Q = {};
jest.mock("@/lib/queries/lab-specimens", () => ({
  useLabPartnerDashboardStats: () => stats,
}));

import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { LabPartnerFirst } from "./lab-partner-first";

const good = (delayed: number) => ({
  data: {
    orders_today: 0, samples_received_today: 0, samples_processing: 0,
    samples_completed_today: 0, samples_rejected_today: 0, samples_delayed: delayed,
  },
});

describe("LabPartnerFirst", () => {
  it("leads with delayed samples as a link and lists the rest", () => {
    stats = good(2);
    render(<LabPartnerFirst awaiting={3} />);
    const section = screen.getByRole("region", { name: "Needs you first" });
    const links = Array.from(section.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["2 samples are past turnaround", "3 orders need a result"]);
  });

  it("says what was checked when nothing is waiting", () => {
    stats = good(0);
    render(<LabPartnerFirst awaiting={0} />);
    expect(screen.getByText(/No delayed samples and no orders waiting/)).toBeTruthy();
  });

  it("does not say nothing is waiting when the orders read failed", () => {
    stats = good(0);
    render(<LabPartnerFirst awaiting={null} />);
    expect(screen.getByRole("alert").textContent).toMatch(/cannot say whether anything is waiting/);
    expect(screen.queryByText(/No delayed samples/)).toBeNull();
  });

  it("does not say nothing is waiting when the sample counts failed", () => {
    stats = { isError: true };
    render(<LabPartnerFirst awaiting={0} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/No delayed samples/)).toBeNull();
  });

  it("says the list is incomplete when only one source failed", () => {
    stats = { isError: true };
    render(<LabPartnerFirst awaiting={2} />);
    expect(screen.getByText(/This list is incomplete/)).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    stats = good(1);
    const { container } = render(<LabPartnerFirst awaiting={2} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
