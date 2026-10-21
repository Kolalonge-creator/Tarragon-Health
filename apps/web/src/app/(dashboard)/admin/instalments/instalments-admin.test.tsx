/** @jest-environment jsdom */
/**
 * S25b: the admin view of Memberships paid in parts. It says whether the module is on, counts plans by state, shows the money still to
 * come and the money overdue, and lists the open plans. It never invents a number when the reply cannot be read.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expectNoA11yViolations } from "@/test/a11y";
import { InstalmentsAdmin, parseOverview } from "./instalments-admin";

const OVERVIEW = {
  module_on: true,
  counts: { active: 2, lapsed: 1, completed: 4 },
  outstanding_kobo: 20_000_000,
  overdue_kobo: 3_333_333,
  plans: [
    { plan_id: "p1", order_id: "o1", state: "lapsed", patient_name: "Ada Obi", parts: 3, paid_parts: 1, price_kobo: 10_000_000, next_due_at: "2026-11-01T00:00:00Z", lapsed_at: "2026-11-10T00:00:00Z", first_paid_at: "2026-10-01T00:00:00Z" },
    { plan_id: "p2", order_id: "o2", state: "active", patient_name: null, parts: 3, paid_parts: 2, price_kobo: 10_000_000, next_due_at: "2026-12-01T00:00:00Z", lapsed_at: null, first_paid_at: "2026-10-01T00:00:00Z" },
  ],
};

let reply: { data: unknown; error: { message: string } | null };
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: async () => reply }) }));

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><InstalmentsAdmin /></QueryClientProvider>;
}

describe("parseOverview", () => {
  it("reads a good reply and refuses one it cannot read", () => {
    expect(parseOverview(OVERVIEW)?.plans).toHaveLength(2);
    expect(parseOverview(null)).toBeNull();
    expect(parseOverview({ ...OVERVIEW, module_on: "yes" })).toBeNull();
  });
});

describe("InstalmentsAdmin", () => {
  it("says the module is on, counts the plans by state and shows what is still to come and what is overdue", async () => {
    reply = { data: OVERVIEW, error: null };
    render(wrap());
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Paying in parts is on/));
    expect(screen.getByText("Lapsed (access paused)").nextSibling?.textContent).toBe("1");
    expect(screen.getByText("Waiting for first payment").nextSibling?.textContent).toBe("0");
    expect(screen.getByText("₦200,000.00")).toBeTruthy();
    expect(screen.getByText("₦33,333.33")).toBeTruthy();
    expect(screen.getByText("Ada Obi")).toBeTruthy();
    expect(screen.getByText(/1 of 3 paid/)).toBeTruthy();
    expect(screen.getByText(/^Lapsed \d/)).toBeTruthy();
    expect(screen.getByText("Unknown patient")).toBeTruthy();
  });

  it("says plainly that nobody can start a plan while it is off, and that existing plans keep running", async () => {
    reply = { data: { ...OVERVIEW, module_on: false, plans: [] }, error: null };
    render(wrap());
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/off.*Nobody can start a new plan.*keep running/));
    expect(screen.getByText("No open plans.")).toBeTruthy();
  });

  it("shows a calm error rather than a made-up number when the reply cannot be read", async () => {
    reply = { data: { nope: 1 }, error: null };
    render(wrap());
    await waitFor(() => expect(screen.getByText("The overview could not be read.")).toBeTruthy());
  });

  it("has no accessibility violations", async () => {
    reply = { data: OVERVIEW, error: null };
    await expectNoA11yViolations(wrap());
  });
});
