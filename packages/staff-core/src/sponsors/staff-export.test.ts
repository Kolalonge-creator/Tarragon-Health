import { describe, expect, it, jest } from "@jest/globals";
import { staffExportResponse, type StaffRpc } from "./staff-export";

const ID = "6f1d7a52-0000-4000-8000-000000000001";
const held = { held_back: true, reason: "small_change", minimum: 20, limitations: "held" };
const figures = { ok: true, months: [{ period: "2026-09-01", generated_at: "x", figures: held }] };
const make = (...answers: { data: unknown; error: unknown }[]) => {
  const rpc = jest.fn<StaffRpc>();
  for (const a of answers) rpc.mockResolvedValueOnce(a);
  return rpc;
};
const run = (role: string | null | undefined, rpc: jest.Mock<StaffRpc>, cohortId = ID) => staffExportResponse({ role, cohortId, rpc, now: new Date("2026-10-07T10:00:00Z") });

describe("staffExportResponse", () => {
  for (const role of ["patient", "clinician", "admin", "payer_admin", null, undefined]) {
    it(`refuses ${String(role)} without touching the database`, async () => {
      const rpc = make();
      expect((await run(role, rpc)).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  it("treats a malformed id as not found without touching the database", async () => {
    const rpc = make();
    expect((await run("corporate_admin", rpc, "nope")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gives no file when the access could not be logged, and never reads the figures", async () => {
    const rpc = make({ data: null, error: { message: "x" } });
    expect((await run("hmo_admin", rpc)).status).toBe(500);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("log_sponsor_staff_export", { p_cohort: ID });
  });

  it("answers another sponsor's programme exactly like a missing one", async () => {
    const rpc = make({ data: { ok: false }, error: null });
    const res = await run("ngo_admin", rpc);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("gives the file after logging, with no caching, for each of the three roles", async () => {
    for (const role of ["corporate_admin", "hmo_admin", "ngo_admin"]) {
      const rpc = make({ data: { ok: true }, error: null }, { data: figures, error: null });
      const res = await run(role, rpc);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(rpc.mock.calls[0][0]).toBe("log_sponsor_staff_export");
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(res.headers.get("Content-Disposition")).toContain("tarragon-programme-figures-2026-10-07.csv");
      expect(await res.text()).toContain("2026-09-01,report,status,held_back");
    }
  });

  it("dates the file in Lagos, not UTC", async () => {
    const rpc = make({ data: { ok: true }, error: null }, { data: figures, error: null });
    const res = await staffExportResponse({ role: "hmo_admin", cohortId: ID, rpc, now: new Date("2026-10-07T23:30:00Z") });
    expect(res.headers.get("Content-Disposition")).toContain("2026-10-08");
  });

  it("does not give a half file when the figures cannot be read", async () => {
    const rpc = make({ data: { ok: true }, error: null }, { data: { ok: true, months: "bad" }, error: null });
    expect((await run("corporate_admin", rpc)).status).toBe(502);
  });
});
