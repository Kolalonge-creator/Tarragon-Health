import { describe, expect, it, jest } from "@jest/globals";
import { fetchLicenceVerifiedOn, formatLicenceVerifiedDate } from "./licence-verified";

const STAFF = "11111111-1111-4111-8111-111111111111";
const PROFILE = "22222222-2222-4222-8222-222222222222";

function client(result: { data: unknown; error: unknown }) {
  const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>().mockResolvedValue(result);
  return { rpc };
}

describe("fetchLicenceVerifiedOn (Q17: a date, only when a stored record exists)", () => {
  it("maps a returned record under both its staff id and its profile id", async () => {
    const c = client({ data: [{ staff_id: STAFF, profile_id: PROFILE, verified_on: "2026-10-05" }], error: null });
    const m = await fetchLicenceVerifiedOn(c, [STAFF]);
    expect(m.get(STAFF)).toBe("2026-10-05");
    expect(m.get(PROFILE)).toBe("2026-10-05");
    expect(c.rpc).toHaveBeenCalledWith("clinician_licence_verified_on", { p_ids: [STAFF] });
  });
  it("no record means no entry, so no badge", async () => {
    expect((await fetchLicenceVerifiedOn(client({ data: [], error: null }), [STAFF])).size).toBe(0);
  });
  it("a failed lookup shows no badge instead of inventing one", async () => {
    expect((await fetchLicenceVerifiedOn(client({ data: null, error: { message: "boom" } }), [STAFF])).size).toBe(0);
  });
  it("a malformed answer (no ISO date) shows no badge", async () => {
    expect((await fetchLicenceVerifiedOn(client({ data: [{ staff_id: STAFF, profile_id: null, verified_on: "yesterday" }], error: null }), [STAFF])).size).toBe(0);
  });
  it("never calls the database for ids that are not uuids, and de-duplicates", async () => {
    const c = client({ data: [], error: null });
    await fetchLicenceVerifiedOn(c, ["not-an-id", STAFF, STAFF]);
    expect(c.rpc).toHaveBeenCalledWith("clinician_licence_verified_on", { p_ids: [STAFF] });
    const none = client({ data: [], error: null });
    await fetchLicenceVerifiedOn(none, ["", "x"]);
    expect(none.rpc).not.toHaveBeenCalled();
  });
  it("a result row that carries a folio number does not leak it into the map", async () => {
    const c = client({ data: [{ staff_id: STAFF, profile_id: null, verified_on: "2026-10-05", credential_number: "MDCN/R/123456" }], error: null });
    const m = await fetchLicenceVerifiedOn(c, [STAFF]);
    expect([...m.values()].join(" ")).not.toContain("123456");
  });
});

describe("formatLicenceVerifiedDate", () => {
  it("formats a calendar date without shifting the day", () => {
    expect(formatLicenceVerifiedDate("2026-10-05")).toBe("5 Oct 2026");
    expect(formatLicenceVerifiedDate("2026-12-31")).toBe("31 Dec 2026");
  });
});
