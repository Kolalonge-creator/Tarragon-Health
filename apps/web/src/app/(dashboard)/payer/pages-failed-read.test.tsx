/** @jest-environment jsdom */
/**
 * A payer console page whose read fails must say so. It used to hand the
 * manager an empty list, which then read "No claims yet", "No plans yet" and so
 * on, and the overview called a database error "not enough members yet".
 */
jest.mock("server-only", () => ({}));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

type Reply = { data: unknown; error: { message: string } | null };
let replies: Record<string, Reply> = {};

jest.mock("@/lib/payer/scope", () => ({
  resolveSelectedInsurer: async () => ({ options: [{ id: "i1", name: "Avon" }], selected: { id: "i1", name: "Avon" } }),
}));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => ({ role: "payer_admin" }) }));
jest.mock("@/lib/supabase/server", () => {
  const { fakeSupabase } = jest.requireActual("@/lib/institutions/fake-supabase");
  return { createClient: async () => fakeSupabase(replies) };
});

const Marker = () => <div data-testid="manager" />;
jest.mock("./insurer-picker", () => ({ InsurerPicker: () => null }));
jest.mock("./claims/claims-manager", () => ({ ClaimsManager: Marker }));
jest.mock("./plans/plans-manager", () => ({ PlansManager: Marker }));
jest.mock("./network/network-manager", () => ({ NetworkManager: Marker }));
jest.mock("./preauthorizations/preauthorizations-manager", () => ({ PreauthorizationsManager: Marker }));
jest.mock("./programmes/programmes-manager", () => ({ ProgrammesManager: Marker }));
jest.mock("./team/team-manager", () => ({ TeamManager: Marker }));
jest.mock("./board-report/generate-report-form", () => ({ GenerateReportForm: () => null }));

import { render, screen } from "@testing-library/react";
import ClaimsPage from "./claims/page";
import PlansPage from "./plans/page";
import NetworkPage from "./network/page";
import PreauthPage from "./preauthorizations/page";
import ProgrammesPage from "./programmes/page";
import TeamPage from "./team/page";
import BoardReportPage from "./board-report/page";
import OverviewPage from "./page";

const ok = (data: unknown): Reply => ({ data, error: null });
const fails: Reply = { data: null, error: { message: "boom" } };
const props = { searchParams: Promise.resolve({}) };

type Case = { name: string; page: (p: typeof props) => Promise<React.ReactElement>; table: string; word: string };
const listCases: Case[] = [
  { name: "claims", page: ClaimsPage, table: "insurance_claims", word: "Claims" },
  { name: "plans", page: PlansPage, table: "payer_plans", word: "Plans" },
  { name: "network", page: NetworkPage, table: "payer_network_providers", word: "Provider network" },
  { name: "pre-authorisations", page: PreauthPage, table: "insurance_preauthorizations", word: "Pre-authorisations" },
  { name: "team", page: TeamPage, table: "payer_administrators", word: "Team" },
];

beforeEach(() => {
  replies = {};
});

describe.each(listCases)("payer $name page", ({ page, table, word }) => {
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

describe("payer programmes page", () => {
  it.each(["payer_programme_directives", "chronic_condition_programmes"])("fails visibly when %s cannot be read", async (table) => {
    replies = { payer_programme_directives: ok([]), chronic_condition_programmes: ok([]), [table]: fails };
    render(await ProgrammesPage(props));
    expect(screen.getByRole("alert").textContent).toContain("Care programmes could not be loaded");
    expect(screen.queryByTestId("manager")).toBeNull();
  });
  it("renders the manager when both reads work", async () => {
    replies = { payer_programme_directives: ok([]), chronic_condition_programmes: ok([]) };
    render(await ProgrammesPage(props));
    expect(screen.getByTestId("manager")).toBeTruthy();
  });
});

describe("payer outcomes reports page", () => {
  it("says the issued reports could not be loaded, not 'No report has been generated'", async () => {
    replies = { payer_board_reports: fails };
    render(await BoardReportPage(props));
    expect(screen.getByRole("alert").textContent).toContain("issued reports could not be loaded");
    expect(screen.queryByText(/No report has been generated/)).toBeNull();
  });
  it("shows the genuine empty state when the read works", async () => {
    replies = { payer_board_reports: ok([]) };
    render(await BoardReportPage(props));
    expect(screen.getByText(/No report has been generated/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("payer overview page", () => {
  it("calls a failed read a failure, not 'not enough members yet'", async () => {
    replies = { payer_dashboard_analytics: fails };
    render(await OverviewPage(props));
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByText("Not enough members yet")).toBeNull();
  });
  it("keeps the privacy message for a genuinely suppressed cohort", async () => {
    replies = { payer_dashboard_analytics: ok({ suppressed: true, min_cohort_size: 10 }) };
    render(await OverviewPage(props));
    expect(screen.getByText("Not enough members yet")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("shows the figures when the read works", async () => {
    replies = { payer_dashboard_analytics: ok({ suppressed: false, min_cohort_size: 10, member_count: 40, programmes: [] }) };
    render(await OverviewPage(props));
    expect(screen.getByText("40")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
