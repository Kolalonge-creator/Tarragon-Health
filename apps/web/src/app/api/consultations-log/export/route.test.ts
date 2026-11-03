import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const getCurrentProfile = jest.fn<() => Promise<unknown>>();
const getCurrentClinicalStaff = jest.fn<() => Promise<unknown>>();
const rpc = jest.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: () => getCurrentProfile(),
  getCurrentClinicalStaff: () => getCurrentClinicalStaff(),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: (n: string, a: unknown) => rpc(n, a) }) }));

import { NextRequest } from "next/server";
import { GET } from "./route";
import { firstLiveCall } from "@/lib/consultations/consultations-log.fixture";

const req = (q = "") => new NextRequest(`https://app.example.test/api/consultations-log/export${q}`);

describe("consultations log CSV download", () => {
  beforeEach(() => {
    rpc.mockReset();
    getCurrentClinicalStaff.mockResolvedValue(null);
  });

  it("refuses a doctor who is not the CMO, without reading the log", async () => {
    getCurrentProfile.mockResolvedValue({ role: "clinician" });
    getCurrentClinicalStaff.mockResolvedValue({ doctor_tier: "senior_medical_officer", active: true });
    expect((await GET(req())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gives an admin the file with the page's filters", async () => {
    getCurrentProfile.mockResolvedValue({ role: "admin" });
    rpc.mockImplementation(async (name) => (name === "consultations_log" ? { data: [firstLiveCall], error: null } : { data: null, error: null }));
    const res = await GET(req("?tests=1&status=completed"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(rpc).toHaveBeenCalledWith("consultations_log", expect.objectContaining({ p_include_tests: true, p_status: "completed" }));
    expect(await res.text()).toContain("k boss");
    expect(rpc).toHaveBeenCalledWith("log_consultations_log_export", expect.objectContaining({ p_include_tests: true, p_rows: 1 }));
  });

  it("gives no file when the download cannot be recorded", async () => {
    getCurrentProfile.mockResolvedValue({ role: "admin" });
    rpc.mockImplementation(async (name) =>
      name === "consultations_log" ? { data: [firstLiveCall], error: null } : { data: null, error: { message: "audit down" } },
    );
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("k boss");
  });

  it("gives the CMO the file too", async () => {
    getCurrentProfile.mockResolvedValue({ role: "clinician" });
    getCurrentClinicalStaff.mockResolvedValue({ doctor_tier: "chief_medical_officer", active: true });
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await GET(req())).status).toBe(200);
  });

  it("does not hand over a half file when the log cannot be read", async () => {
    getCurrentProfile.mockResolvedValue({ role: "admin" });
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await GET(req())).status).toBe(502);
  });
});
