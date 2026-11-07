/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type { EmployerRevenueRow, MembershipRevenue } from "@/lib/finance/revenue-workspaces";

const mockRev = jest.fn();
const mockList = jest.fn();
const mockSpons = jest.fn();
const mockEmp = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => "/finance/memberships",
  useSearchParams: () => new URLSearchParams("period=this_month"),
}));

jest.mock("@/lib/finance/revenue-workspaces", () => {
  const actual = jest.requireActual("@/lib/finance/revenue-workspaces");
  return {
    ...actual,
    useMembershipRevenue: () => mockRev(),
    useMembershipsList: () => mockList(),
    useSponsorships: () => mockSpons(),
    useEmployerRevenue: () => mockEmp(),
  };
});

import { EmployerRevenueWorkspace, MembershipWorkspace, SponsorshipsWorkspace } from "./revenue-workspaces";
import { employerTotals, renewalRateText } from "@/lib/finance/revenue-workspaces";

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false });
const failed = { data: undefined, isLoading: false, isError: true };

const REV: MembershipRevenue = {
  from: "2026-11-01",
  to: "2026-11-07",
  as_of: "2026-11-07",
  generated_at: "2026-11-07T10:00:00Z",
  in_force: { paid: 3, individual: 1, family_sponsor: 1, employer: 1, granted: 1, auto_renew: 1 },
  new_paid: 2,
  renewals: 1,
  ended_early: 0,
  lapsed: 1,
  expiring_30d: 1,
  expiring_30d_auto_renew: 1,
  renewal_due: 2,
  renewal_renewed: 1,
  renewal_rate: 0.5,
  failed_renewal_charges: 1,
  revenue: { gross_minor: 20150000, payments: 2, refunds_minor: 0, net_minor: 20150000, renewal_gross_minor: 10000000, individual_minor: 10150000, family_sponsor_minor: 10000000, employer_minor: 0 },
};

const EMP: EmployerRevenueRow = {
  organisation_id: "e1",
  name: "Acme Nigeria Ltd",
  contact: "Bisi Ade",
  contract: { name: "Annual seats", status: "active", effective_from: "2026-10-01", effective_to: "2026-12-01", employee_count: 10, price_per_employee_minor: 9000000, billing_model: "per_employee", reference: null },
  seats: null,
  invoiced_minor: 90000000,
  paid_minor: 45000000,
  outstanding_minor: 45000000,
  overdue_minor: 45000000,
  open_invoices: 1,
  last_paid_at: "2026-10-15T09:00:00Z",
  members_in_force: 6,
  renewal_date: "2026-12-01",
  renewal_within_60d: true,
};

describe("helpers", () => {
  it("states the renewal rate with its denominator, never 0% for nothing due", () => {
    expect(renewalRateText(REV)).toBe("1 of 2 renewed (50%)");
    expect(renewalRateText({ ...REV, renewal_due: 0, renewal_renewed: 0, renewal_rate: null })).toMatch(/No Memberships were due/);
  });
  it("adds employer totals", () => {
    expect(employerTotals([EMP, { ...EMP, organisation_id: "e2", overdue_minor: 0 }])).toEqual({
      invoiced: 180000000, paid: 90000000, outstanding: 90000000, overdue: 45000000, members: 12,
    });
  });
});

describe("MembershipWorkspace", () => {
  beforeEach(() => {
    mockRev.mockReset();
    mockList.mockReset();
  });

  it("splits paid Memberships by payer and keeps granted ones out of the paid count", () => {
    mockRev.mockReturnValue(ok(REV));
    mockList.mockReturnValue(ok({ total: 0, limit: 50, offset: 0, rows: [] }));
    render(<MembershipWorkspace />);
    expect(screen.getByText("Paid by a family sponsor")).toBeTruthy();
    expect(screen.getByText(/1 granted free are not counted/)).toBeTruthy();
    expect(screen.getByText(/1 of 2 renewed \(50%\)/)).toBeTruthy();
  });

  it("names the sponsor apart from the member in the list", () => {
    mockRev.mockReturnValue(ok(REV));
    mockList.mockReturnValue(
      ok({
        total: 1,
        limit: 50,
        offset: 0,
        rows: [{
          id: "m1", state: "active", source: "purchase", tier: "evergreen", payer_type: "family_sponsor",
          beneficiary: "Halima Bello", sponsor: "Femi Adeyemi", employer: null, starts_at: "2026-11-01T09:00:00Z",
          ends_at: "2027-11-01T09:00:00Z", ended_at: null, end_reason: null, auto_renew: false, amount_paid_minor: 10000000,
          paid_at: "2026-11-01T09:00:00Z", paystack_reference: "REF", order_id: "o1", is_renewal: false, renewed: false,
        }],
      })
    );
    const { container } = render(<MembershipWorkspace />);
    expect(screen.getByText("Halima Bello")).toBeTruthy();
    expect(screen.getByText("Femi Adeyemi")).toBeTruthy();
    expect(container.querySelector('a[href="/finance/transactions/order/o1"]')).toBeTruthy();
  });

  it("does not show failed reads as zeros or an empty list", () => {
    mockRev.mockReturnValue(failed);
    mockList.mockReturnValue(failed);
    render(<MembershipWorkspace />);
    expect(screen.getByText(/could not be loaded, so none are shown rather than zeros/)).toBeTruthy();
    expect(screen.getByText(/not the same as there being none/)).toBeTruthy();
  });
});

describe("SponsorshipsWorkspace", () => {
  it("shows sponsor and beneficiary apart and says sponsorship gives no record access", () => {
    mockSpons.mockReturnValue(
      ok({
        total: 1, total_minor: 2500000, sponsors: 1, beneficiaries: 1, limit: 50, offset: 0,
        rows: [{ kind: "care_voucher", record_id: "v1", paid_at: "2026-11-02T09:00:00Z", amount_minor: 2500000, reference: "CV-1", status: "active", sponsor: "Tunde Bakare", beneficiary: "Ngozi Eze", item: "x", membership: null }],
      })
    );
    render(<SponsorshipsWorkspace />);
    expect(screen.getByText("Tunde Bakare")).toBeTruthy();
    expect(screen.getByText("Ngozi Eze")).toBeTruthy();
    expect(screen.getByText(/no access to the member's health record/)).toBeTruthy();
  });
});

describe("EmployerRevenueWorkspace", () => {
  it("shows invoiced, paid, outstanding and overdue, and flags a renewal within 60 days", () => {
    mockEmp.mockReturnValue(ok([EMP]));
    render(<EmployerRevenueWorkspace />);
    expect(screen.getByText("Acme Nigeria Ltd")).toBeTruthy();
    expect(screen.getAllByText("₦450,000").length).toBeGreaterThan(0);
    expect(screen.getByText("₦450,000 overdue")).toBeTruthy();
    expect(screen.getByText("within 60 days")).toBeTruthy();
  });

  it("does not show a failed read as no employers", () => {
    mockEmp.mockReturnValue(failed);
    render(<EmployerRevenueWorkspace />);
    expect(screen.getByText(/not the same as there being none/)).toBeTruthy();
    expect(screen.queryByText(/No employer has a contract/)).toBeNull();
  });
});
