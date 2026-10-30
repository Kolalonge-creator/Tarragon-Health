/** @jest-environment jsdom */
/**
 * The employer-facing panels that read through React Query must say so when a
 * read fails. A failed read used to fall through to the empty-state copy
 * ("No one on your roster yet", "No invoices yet", "No active contract yet"),
 * which a roster owner or a finance contact acts on.
 */
import { render, screen } from "@testing-library/react";

type Q = { data?: unknown; isLoading?: boolean; isError?: boolean };
const idle = { mutate: jest.fn(), isPending: false, error: null };

const q: Record<string, Q> = {};
const set = (key: string, value: Q) => {
  q[key] = { data: undefined, isLoading: false, isError: false, ...value };
};

jest.mock("@/lib/queries/employer-roster", () => ({
  useEmployerRoster: () => q.roster,
  useEmployerRosterCounts: () => q.counts,
  useAddRosterMember: () => idle,
  useClaimRosterMember: () => idle,
  useRemoveRosterMember: () => idle,
  useMarkRosterMemberDeparted: () => idle,
  useInviteRosterMember: () => idle,
  useAssignBenefitPackage: () => idle,
}));
jest.mock("@/lib/queries/employer-accounts", () => ({
  useEmployerDepartments: () => ({ data: [] }),
  useEmployerLocations: () => ({ data: [] }),
  useCorporateContract: () => q.contract,
}));
jest.mock("@/lib/queries/employer-benefits", () => ({ useBenefitPackages: () => ({ data: [] }) }));
jest.mock("@/lib/queries/employer-invoices", () => ({ useEmployerInvoices: () => q.invoices }));
jest.mock("@/lib/queries/outcome-reports", () => ({
  useOutcomeReports: () => q.reports,
  useTogglePublished: () => idle,
  reportsKey: () => ["reports"],
}));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("./actions", () => ({ generateOutcomeReport: jest.fn() }));

import { RosterManager } from "./roster-manager";
import { EmployerBillingPanel } from "./employer-billing-panel";
import { OutcomeEvidenceSummary } from "./outcome-evidence-summary";
import { OutcomeReportsPanel } from "./outcome-reports-panel";

beforeEach(() => {
  set("roster", { data: [] });
  set("counts", { data: { eligible_count: 4, activated_count: 2 } });
  set("contract", { data: null });
  set("invoices", { data: [] });
  set("reports", { data: [] });
});

describe("RosterManager", () => {
  it("says the roster could not be loaded instead of 'No one on your roster yet'", () => {
    set("roster", { isError: true });
    render(<RosterManager organisationId="org-1" />);
    expect(screen.getByRole("alert").textContent).toContain("roster could not be loaded");
    expect(screen.queryByText(/No one on your roster yet/)).toBeNull();
  });

  it("says the counts could not be loaded instead of dropping the tiles quietly", () => {
    set("counts", { isError: true });
    render(<RosterManager organisationId="org-1" />);
    expect(screen.getByRole("alert").textContent).toContain("enrolment counts could not be loaded");
    expect(screen.queryByText("Eligible employees")).toBeNull();
  });

  it("keeps the genuine empty state when the read worked", () => {
    render(<RosterManager organisationId="org-1" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/No one on your roster yet/)).toBeTruthy();
    expect(screen.getByText("Eligible employees")).toBeTruthy();
  });
});

describe("EmployerBillingPanel", () => {
  it("says invoices and contract could not be loaded instead of 'No invoices yet' / 'No active contract yet'", () => {
    set("contract", { isError: true });
    set("invoices", { isError: true });
    render(<EmployerBillingPanel organisationId="org-1" />);
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts.some((t) => t?.includes("invoices could not be loaded"))).toBe(true);
    expect(alerts.some((t) => t?.includes("contract terms could not be loaded"))).toBe(true);
    expect(screen.queryByText("No invoices yet.")).toBeNull();
    expect(screen.queryByText("No active contract yet.")).toBeNull();
  });

  it("shows loading, not an empty state, while the reads are in flight", () => {
    set("contract", { isLoading: true });
    set("invoices", { isLoading: true });
    render(<EmployerBillingPanel organisationId="org-1" />);
    expect(screen.queryByText("No invoices yet.")).toBeNull();
    expect(screen.queryByText("No active contract yet.")).toBeNull();
    expect(screen.getAllByText("Loading…")).toHaveLength(2);
  });

  it("keeps the genuine empty states when the reads worked", () => {
    render(<EmployerBillingPanel organisationId="org-1" />);
    expect(screen.getByText("No invoices yet.")).toBeTruthy();
    expect(screen.getByText("No active contract yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("OutcomeEvidenceSummary", () => {
  it("says the history could not be loaded instead of 'Not enough report history yet'", () => {
    set("reports", { isError: true });
    render(<OutcomeEvidenceSummary organisationId="org-1" />);
    expect(screen.getByRole("alert").textContent).toContain("report history could not be loaded");
    expect(screen.queryByText(/Not enough report history yet/)).toBeNull();
  });

  it("keeps the genuine message when the read worked", () => {
    render(<OutcomeEvidenceSummary organisationId="org-1" />);
    expect(screen.getByText(/Not enough report history yet/)).toBeTruthy();
  });
});

describe("OutcomeReportsPanel", () => {
  it("says saved reports could not be loaded instead of staying silent", () => {
    set("reports", { isError: true });
    render(<OutcomeReportsPanel organisationId="org-1" />);
    expect(screen.getByRole("alert").textContent).toContain("saved reports could not be loaded");
    expect(screen.queryByText("No reports generated yet.")).toBeNull();
  });

  it("keeps the genuine empty state when the read worked", () => {
    render(<OutcomeReportsPanel organisationId="org-1" />);
    expect(screen.getByText("No reports generated yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
