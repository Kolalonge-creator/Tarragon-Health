/** @jest-environment jsdom */
/**
 * The lab partner overview and results pages must not turn a failed read into
 * "0 orders", "All caught up" or "Nothing is waiting for you".
 */
jest.mock("server-only", () => ({}));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
jest.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

type Reply = { data: unknown; error: { message: string } | null };
let replies: Record<string, Reply> = {};
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: async () => ({ role: "lab_partner", is_partner_admin: false }),
}));
jest.mock("@/lib/supabase/server", () => {
  const { fakeSupabase } = jest.requireActual("@/lib/institutions/fake-supabase");
  return { createClient: async () => fakeSupabase(replies) };
});
jest.mock("@/lib/ai-coach/lagos-day", () => ({ startOfLagosDayUtc: () => new Date("2026-10-30T23:00:00.000Z") }));

jest.mock("./lab-partner-worklist", () => ({ LabPartnerWorklist: () => null }));
jest.mock("./lab-partner-turnaround-card", () => ({ LabPartnerTurnaroundCard: () => null }));
jest.mock("./lab-partner-facilities", () => ({ LabPartnerFacilities: () => null }));
jest.mock("./lab-partner-services", () => ({ LabPartnerServices: () => null }));
jest.mock("./lab-partner-specimen-board", () => ({ LabPartnerSpecimenBoard: () => null }));
jest.mock("./lab-partner-dashboard-stats-row", () => ({ LabPartnerDashboardStatsRow: () => null }));
jest.mock("./lab-partner-first", () => ({ LabPartnerFirst: () => null }));
jest.mock("@/components/partner-admin/partner-staff-invite-form", () => ({ PartnerStaffInviteForm: () => null }));
jest.mock("./results/result-entry", () => ({ OrderResultCard: () => <div data-testid="order" /> }));

import { render, screen } from "@testing-library/react";
import OverviewPage from "./page";
import ResultsPage from "./results/page";

const ok = (data: unknown): Reply => ({ data, error: null });
const fails: Reply = { data: null, error: { message: "boom" } };

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-10-31T10:00:00.000Z"));
  replies = {};
});
afterEach(() => jest.useRealTimers());

describe("lab partner overview page", () => {
  it("says the counts are unknown, never 0 or 'All caught up', when the orders read fails", async () => {
    replies = { lab_partner_orders: fails };
    const { container } = render(await OverviewPage());
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(container.textContent).not.toContain("All caught up");
    expect(screen.getAllByText("Could not be loaded")).toHaveLength(4);
  });

  it("shows real counts and 'Needs a result uploaded' when the read works", async () => {
    replies = {
      lab_partner_orders: ok([
        { status: "processing", resulted_at: null },
        { status: "sample_rejected", resulted_at: null },
        { status: "resulted", resulted_at: "2026-10-31T09:00:00+00:00" },
      ]),
    };
    const { container } = render(await OverviewPage());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toContain("Needs a result uploaded");
    expect(container.textContent).not.toContain("Could not be loaded");
  });

  it("says 'All caught up' for an empty queue that was actually read", async () => {
    replies = { lab_partner_orders: ok([]) };
    const { container } = render(await OverviewPage());
    expect(container.textContent).toContain("All caught up");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("lab partner results page", () => {
  it("says the orders could not be loaded instead of 'Nothing is waiting for you'", async () => {
    replies = { lab_partner_portal_orders: fails };
    render(await ResultsPage());
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByText("Nothing is waiting for you.")).toBeNull();
    expect(screen.getByText("Waiting for a result").textContent).not.toContain("(0)");
  });

  it("keeps the genuine empty state when the read works", async () => {
    replies = { lab_partner_portal_orders: ok([]) };
    render(await ResultsPage());
    expect(screen.getByText("Nothing is waiting for you.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lists orders when the read works", async () => {
    replies = { lab_partner_portal_orders: ok([{ order_id: "o1", result_received: false }]) };
    render(await ResultsPage());
    expect(screen.getByTestId("order")).toBeTruthy();
  });
});
