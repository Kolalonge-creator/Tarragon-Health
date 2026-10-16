import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";

const rpc = jest.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { GET } from "./route";

const ID = "6f1d6c1e-4f5e-4a52-9d57-2a3c1d3b8f10";
const report = {
  pilot: { id: ID, state: "active", starts_on: "2026-11-02", ends_on: "2026-12-02", terms_version: "terms-v1", total_kobo: 120000000, seat_price_kobo: 10000000 },
  seats: { purchased: 12, claimed: 12, active: 11, unclaimed: 0, claims_without_seat: 0 },
  usage: { suppressed: true, reason: "too_few_members" },
  min_cell: 5,
  rounded_to: 5,
  usage_through: "2026-11-08",
  generated_at: "2026-11-10T09:00:00Z",
  // a field a future change might leak; the route must not pass it through
  members: [{ full_name: "Ada Obi" }],
};

const req = (qs: string) => new NextRequest(`http://localhost/dashboard/corporate/pilot/export${qs}`);

beforeEach(() => rpc.mockReset());

describe("pilot CSV export", () => {
  it("rejects a missing or malformed pilot id without touching the database", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("?pilot=nope"))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers not found when the database says the caller may not read this report", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "pilot_report_not_authorised" } });
    expect((await GET(req(`?pilot=${ID}`))).status).toBe(404);
  });

  it("returns the aggregate CSV only, never a per-person field, and is not cacheable", async () => {
    rpc.mockResolvedValue({ data: report, error: null });
    const res = await GET(req(`?pilot=${ID}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("Seats purchased,12");
    expect(body).toContain("withheld");
    expect(body).not.toContain("Ada Obi");
    expect(rpc).toHaveBeenCalledWith("employer_seat_pilot_report", { p_pilot: ID });
  });

  it("fails closed on a payload it does not recognise", async () => {
    rpc.mockResolvedValue({ data: { seats: {} }, error: null });
    expect((await GET(req(`?pilot=${ID}`))).status).toBe(500);
  });
});
