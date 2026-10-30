/** @jest-environment jsdom */
/** The statements list is cut at 50 newest. At the limit, it says older ones are not listed. */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: async () => ({ role: "admin" }) }));
jest.mock("@/lib/finance/partner-statement-access", () => ({ partnerStatementAccessNotice: () => null }));
jest.mock("./partner-settlements-client", () => ({ PartnerSettlementsClient: () => <div data-testid="client" /> }));

let statementRows: unknown[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const reply = table === "partner_statements" ? { data: statementRows, error: null } : { data: [], error: null };
      const proxy: unknown = new Proxy({}, { get: (_t, p) => (p === "then" ? (r: (v: unknown) => unknown) => r(reply) : () => proxy) });
      return proxy;
    },
  }),
}));

import { render, screen } from "@testing-library/react";
import PartnerSettlementsPage from "./page";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, provider_id: null, reference: `R${i}`, period_start: "2026-10-01", period_end: "2026-10-31", invoiced_total_kobo: 1, expected_total_kobo: 1, status: "draft", currency: "NGN" }));

describe("partner settlements page", () => {
  it("says older statements are not listed when it is exactly at the limit", async () => {
    statementRows = rows(50);
    render(await PartnerSettlementsPage());
    expect(screen.getByRole("status").textContent).toContain("Showing the newest 50 statements");
  });
  it("says nothing for a shorter list", async () => {
    statementRows = rows(3);
    render(await PartnerSettlementsPage());
    expect(screen.queryByRole("status")).toBeNull();
  });
});
