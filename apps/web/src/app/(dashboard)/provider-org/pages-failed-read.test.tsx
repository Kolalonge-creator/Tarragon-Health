/** @jest-environment jsdom */
/**
 * A provider organisation page whose read fails must say so, not show an empty
 * list ("No orders yet", "Nothing routed here yet") or a blank overview.
 */
jest.mock("server-only", () => ({}));

type Reply = { data: unknown; error: { message: string } | null };
let replies: Record<string, Reply> = {};

jest.mock("@/lib/provider-org/scope", () => ({
  resolveSelectedProviderOrg: async () => ({ options: [{ id: "o1", name: "Reddington" }], selected: { id: "o1", name: "Reddington" } }),
}));
jest.mock("@/lib/supabase/server", () => {
  const { fakeSupabase } = jest.requireActual("@/lib/institutions/fake-supabase");
  return { createClient: async () => fakeSupabase(replies) };
});

const Marker = () => <div data-testid="manager" />;
jest.mock("./org-picker", () => ({ OrgPicker: () => null }));
jest.mock("./settlements/settlements-manager", () => ({ SettlementsManager: Marker }));
jest.mock("./locations/locations-manager", () => ({ LocationsManager: Marker }));
jest.mock("./services/services-manager", () => ({ ServicesManager: Marker }));
jest.mock("./resources/resources-manager", () => ({ ResourcesManager: Marker }));
jest.mock("./staff/staff-manager", () => ({ StaffManager: Marker }));

import { render, screen } from "@testing-library/react";
import SettlementsPage from "./settlements/page";
import LocationsPage from "./locations/page";
import ServicesPage from "./services/page";
import ResourcesPage from "./resources/page";
import StaffPage from "./staff/page";
import LabOrdersPage from "./lab-orders/page";
import PharmacyOrdersPage from "./pharmacy-orders/page";
import ReferralsPage from "./referrals/page";
import OverviewPage from "./page";

const ok = (data: unknown): Reply => ({ data, error: null });
const fails: Reply = { data: null, error: { message: "boom" } };
const props = { searchParams: Promise.resolve({}) };

type Case = { name: string; page: (p: typeof props) => Promise<React.ReactElement>; table: string; word: string };
const managerCases: Case[] = [
  { name: "settlements", page: SettlementsPage, table: "provider_org_settlements", word: "Settlements" },
  { name: "locations", page: LocationsPage, table: "provider_org_locations", word: "Locations" },
  { name: "services", page: ServicesPage, table: "provider_org_services", word: "Services" },
  { name: "resources", page: ResourcesPage, table: "provider_org_resources", word: "Resources" },
  { name: "staff", page: StaffPage, table: "provider_org_members", word: "Staff" },
];

beforeEach(() => {
  replies = {};
});

describe.each(managerCases)("provider organisation $name page", ({ page, table, word }) => {
  it("says it could not be loaded, and does not render the manager, when the read fails", async () => {
    replies = { [table]: fails };
    render(await page(props));
    expect(screen.getByRole("alert").textContent).toContain(`${word} could not be loaded`);
    expect(screen.queryByTestId("manager")).toBeNull();
  });
  it("renders the manager and no alert when the read works", async () => {
    replies = { [table]: ok([]) };
    render(await page(props));
    expect(screen.getByTestId("manager")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe.each([
  ["lab orders", LabOrdersPage, "provider_org_lab_order_queue", /No orders yet/],
  ["pharmacy orders", PharmacyOrdersPage, "provider_org_pharmacy_order_queue", /No orders yet/],
] as const)("provider organisation %s page", (_name, page, rpc, emptyText) => {
  it("says the orders could not be loaded instead of 'No orders yet'", async () => {
    replies = { [rpc]: fails };
    render(await page(props));
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByText(emptyText)).toBeNull();
  });
  it("keeps the genuine empty state when the read works", async () => {
    replies = { [rpc]: ok([]) };
    render(await page(props));
    expect(screen.getByText(emptyText)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("provider organisation referrals page", () => {
  it("says the queue could not be loaded instead of 'No referrals routed'", async () => {
    replies = { provider_org_referral_queue: fails, provider_org_referral_queue_summary: ok({}) };
    render(await ReferralsPage(props));
    expect(screen.getByRole("alert").textContent).toContain("referral queue could not be loaded");
    expect(screen.queryByText(/No referrals routed/)).toBeNull();
  });
  it("says the status counts could not be loaded, but still shows the queue", async () => {
    replies = { provider_org_referral_queue: ok([]), provider_org_referral_queue_summary: fails };
    render(await ReferralsPage(props));
    expect(screen.getByRole("alert").textContent).toContain("status counts could not be loaded");
    expect(screen.getByText(/No referrals routed/)).toBeTruthy();
  });
  it("shows the queue and counts when both reads work", async () => {
    replies = { provider_org_referral_queue: ok([]), provider_org_referral_queue_summary: ok({ booked: 2 }) };
    render(await ReferralsPage(props));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("booked: 2")).toBeTruthy();
  });
});

describe("provider organisation overview page", () => {
  const analytics = {
    staff_by_role: { owner: 1 },
    structure: { locations: 2, departments: 1, services: 1, resources: 1 },
    referrals_by_status: { booked: 1, completed: 5 },
    referral_avg_response_hours: 3.5,
  };
  it("says the figures could not be loaded instead of a blank page", async () => {
    replies = { provider_org_analytics: fails };
    render(await OverviewPage(props));
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByText("Open referrals")).toBeNull();
  });
  it("counts only open referrals and shows the response time when a booking exists", async () => {
    replies = { provider_org_analytics: ok(analytics) };
    render(await OverviewPage(props));
    expect(screen.queryByRole("alert")).toBeNull();
    const tile = screen.getByText("Open referrals").closest("div")!.parentElement!;
    expect(tile.textContent).toContain("1");
    expect(tile.textContent).not.toContain("6");
    expect(screen.getByText("3.5")).toBeTruthy();
  });
  it("shows None yet, not 0 hrs, when nothing has been booked", async () => {
    replies = { provider_org_analytics: ok({ ...analytics, referrals_by_status: { pending: 2 }, referral_avg_response_hours: 0 }) };
    render(await OverviewPage(props));
    expect(screen.getByText("None yet")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText(/hrs/)).toBeNull();
  });
});
