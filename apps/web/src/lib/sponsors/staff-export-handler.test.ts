/**
 * A sponsor staff download (S38f): only sponsor staff may ask; the access is written to the audit log BEFORE any file is built, and a
 * download that could not be logged is not given; another sponsor's programme and a missing one get the same answer.
 */
const rpc = jest.fn();
const getCurrentProfile = jest.fn();

jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(async () => ({ rpc })) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfile() }));
jest.mock("@/lib/format-date", () => ({ lagosToday: () => "2026-10-07" }));

import { handleStaffExport } from "./staff-export-handler";

const ID = "6f1d7a52-0000-4000-8000-000000000001";
const held = { held_back: true, reason: "small_change", minimum: 20, limitations: "held" };
const figures = { ok: true, months: [{ period: "2026-09-01", generated_at: "x", figures: held }] };

beforeEach(() => {
  rpc.mockReset();
  getCurrentProfile.mockReset();
});

describe("handleStaffExport", () => {
  it.each(["patient", "clinician", "admin", "payer_admin", undefined])("refuses %s without touching the database", async (role) => {
    getCurrentProfile.mockResolvedValue(role ? { role } : null);
    const res = await handleStaffExport(ID);
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats a malformed id as not found without touching the database", async () => {
    getCurrentProfile.mockResolvedValue({ role: "corporate_admin" });
    expect((await handleStaffExport("nope")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gives no file when the access could not be logged, and never reads the figures", async () => {
    getCurrentProfile.mockResolvedValue({ role: "hmo_admin" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    const res = await handleStaffExport(ID);
    expect(res.status).toBe(500);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("log_sponsor_staff_export", { p_cohort: ID });
  });

  it("answers another sponsor's programme exactly like a missing one", async () => {
    getCurrentProfile.mockResolvedValue({ role: "ngo_admin" });
    rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    const res = await handleStaffExport(ID);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("gives the file after logging, with no caching", async () => {
    getCurrentProfile.mockResolvedValue({ role: "corporate_admin" });
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null }).mockResolvedValueOnce({ data: figures, error: null });
    const res = await handleStaffExport(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(rpc.mock.calls[0][0]).toBe("log_sponsor_staff_export");
    expect(await res.text()).toContain("2026-09-01,report,status,held_back");
    expect(rpc).toHaveBeenCalledTimes(2);   // the log and the figures only: no extra programme listing
  });

  it("does not give a half file when the figures cannot be read", async () => {
    getCurrentProfile.mockResolvedValue({ role: "corporate_admin" });
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null }).mockResolvedValueOnce({ data: { ok: true, months: "bad" }, error: null });
    expect((await handleStaffExport(ID)).status).toBe(502);
  });
});
