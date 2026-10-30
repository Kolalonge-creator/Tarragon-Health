/** @jest-environment jsdom */
/**
 * The lab partner's own panels (counts, turnaround, branches, services and the
 * two worklists) must say so when their read fails, instead of vanishing or
 * falling through to "No branches added yet" and similar empty states.
 */
type Q = { data?: unknown; isLoading?: boolean; isError?: boolean };
const idle = { mutate: jest.fn(), isPending: false, error: null };
const q: Record<string, Q> = {};
const set = (key: string, value: Q) => {
  q[key] = { data: undefined, isLoading: false, isError: false, ...value };
};

jest.mock("@/lib/queries/lab-partner", () => ({
  useLabPartnerOrders: () => q.orders,
  useLabPartnerTurnaroundStats: () => q.turnaround,
  useLabPartnerOwnProviderId: () => q.provider,
  useLabPartnerFacilities: () => q.facilities,
  useLabPartnerOwnTests: () => q.tests,
  useCreateLabPartnerFacility: () => idle,
  useSetLabPartnerFacilityActive: () => idle,
  useSetLabPartnerTestActive: () => idle,
  useLabPartnerRejectSample: () => idle,
  useLabPartnerUploadResult: () => idle,
}));
jest.mock("@/lib/queries/lab-specimens", () => ({
  ...jest.requireActual("@/lib/queries/lab-specimens"),
  useLabPartnerSpecimens: () => q.specimens,
  useLabPartnerDashboardStats: () => q.stats,
  useAdvanceLabSpecimen: () => idle,
  useRejectLabSpecimen: () => idle,
}));

import { render, screen } from "@testing-library/react";
import { LabPartnerDashboardStatsRow } from "./lab-partner-dashboard-stats-row";
import { LabPartnerTurnaroundCard } from "./lab-partner-turnaround-card";
import { LabPartnerFacilities } from "./lab-partner-facilities";
import { LabPartnerServices } from "./lab-partner-services";
import { LabPartnerWorklist } from "./lab-partner-worklist";
import { LabPartnerSpecimenBoard } from "./lab-partner-specimen-board";

const stats = {
  orders_today: 3, samples_received_today: 2, samples_processing: 1,
  samples_completed_today: 1, samples_rejected_today: 0, samples_delayed: 0,
};

beforeEach(() => {
  set("orders", { data: [] });
  set("turnaround", { data: { orders_resulted: 0, avg_turnaround_hours: null, median_turnaround_hours: null, pct_over_72h: null } });
  set("provider", { data: "p1" });
  set("facilities", { data: [] });
  set("tests", { data: [] });
  set("specimens", { data: [] });
  set("stats", { data: stats });
});

describe("sample counts row", () => {
  it("says the counts could not be loaded instead of vanishing", () => {
    set("stats", { isError: true });
    render(<LabPartnerDashboardStatsRow />);
    expect(screen.getByRole("alert").textContent).toContain("sample counts could not be loaded");
  });
  it("keeps the last good counts and says they may be old when only a refresh failed", () => {
    set("stats", { data: stats, isError: true });
    render(<LabPartnerDashboardStatsRow />);
    expect(screen.getByRole("status").textContent).toContain("may be out of date");
    expect(screen.getByText("Orders today")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("is quiet while loading and shows the tiles when the read works", () => {
    set("stats", { isLoading: true });
    const { container, rerender } = render(<LabPartnerDashboardStatsRow />);
    expect(container.textContent).toBe("");
    set("stats", { data: stats });
    rerender(<LabPartnerDashboardStatsRow />);
    expect(screen.getByText("Orders today")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("turnaround card", () => {
  it("says it could not be loaded instead of 'No resulted orders in this window yet'", () => {
    set("turnaround", { isError: true });
    render(<LabPartnerTurnaroundCard />);
    expect(screen.getByRole("alert").textContent).toContain("turnaround figures could not be loaded");
    expect(screen.queryByText(/No resulted orders/)).toBeNull();
  });
  it("keeps the genuine empty message when the read worked", () => {
    render(<LabPartnerTurnaroundCard />);
    expect(screen.getByText(/No resulted orders in this window yet/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("branches", () => {
  it("says the branches could not be loaded when the branch read fails", () => {
    set("facilities", { isError: true });
    render(<LabPartnerFacilities />);
    expect(screen.getByRole("alert").textContent).toContain("branches could not be loaded");
    expect(screen.queryByText("No branches added yet.")).toBeNull();
  });
  it("says so when the provider link itself cannot be read, not 'No branches added yet'", () => {
    set("provider", { isError: true });
    set("facilities", {});
    render(<LabPartnerFacilities />);
    expect(screen.getByRole("alert").textContent).toContain("branches could not be loaded");
    expect(screen.queryByText("No branches added yet.")).toBeNull();
  });
  it("shows Loading, not the empty state, while the branches are in flight", () => {
    set("facilities", { isLoading: true });
    render(<LabPartnerFacilities />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("No branches added yet.")).toBeNull();
  });
  it("renders nothing for a lab with no directory link", () => {
    set("provider", { data: null });
    const { container } = render(<LabPartnerFacilities />);
    expect(container.textContent).toBe("");
  });
  it("keeps the genuine empty state when the read worked", () => {
    render(<LabPartnerFacilities />);
    expect(screen.getByText("No branches added yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("services", () => {
  it("says the services could not be loaded when the test read fails", () => {
    set("tests", { isError: true });
    render(<LabPartnerServices />);
    expect(screen.getByRole("alert").textContent).toContain("services could not be loaded");
    expect(screen.queryByText(/No tests on your catalogue/)).toBeNull();
  });
  it("keeps the card, with a failure notice, when the provider link cannot be read", () => {
    set("provider", { isError: true });
    set("tests", {});
    render(<LabPartnerServices />);
    expect(screen.getByRole("alert").textContent).toContain("services could not be loaded");
  });
  it("renders nothing for a lab with no directory link, and the empty state when linked with no tests", () => {
    set("provider", { data: null });
    const { container, unmount } = render(<LabPartnerServices />);
    expect(container.textContent).toBe("");
    unmount();
    set("provider", { data: "p1" });
    render(<LabPartnerServices />);
    expect(screen.getByText(/No tests on your catalogue/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe.each([
  ["orders worklist", LabPartnerWorklist, "orders", "orders could not be loaded", /No orders routed/],
  ["sample board", LabPartnerSpecimenBoard, "specimens", "samples could not be loaded", /No samples in progress/],
] as const)("%s", (_name, Component, key, failureText, emptyText) => {
  it("shows an alert, not an empty state, when the first read fails", () => {
    set(key, { isError: true });
    render(<Component />);
    expect(screen.getByRole("alert").textContent).toContain(failureText);
    expect(screen.queryByText(emptyText)).toBeNull();
  });
  it("keeps the last good list and says it may be old when only a refresh failed", () => {
    set(key, { data: [], isError: true });
    render(<Component />);
    expect(screen.getByRole("status").textContent).toContain("may be out of date");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows the genuine empty state when the read worked", () => {
    render(<Component />);
    expect(screen.getByText(emptyText)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
