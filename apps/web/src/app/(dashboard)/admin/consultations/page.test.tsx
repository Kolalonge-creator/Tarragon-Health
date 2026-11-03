import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const getCurrentProfile = jest.fn<() => Promise<unknown>>();
const rpc = jest.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: () => getCurrentProfile(),
  getCurrentClinicalStaff: async () => null,
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      order: async () => ({ data: [{ profile_id: "c22fc539-23af-46e4-bf73-f799da147f10", full_name: "Kola Longe" }], error: null }),
    };
    return { rpc: (n: string, a: unknown) => rpc(n, a), from: () => chain };
  },
}));
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import AdminConsultationsLogPage from "./page";
import { firstLiveCall } from "@/lib/consultations/consultations-log.fixture";

const ORG = "00000000-0000-0000-0000-000000000001";
const render = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await AdminConsultationsLogPage({ searchParams: Promise.resolve(params) }));

describe("/admin/consultations", () => {
  beforeEach(() => {
    rpc.mockReset();
    getCurrentProfile.mockResolvedValue({ id: "a", role: "admin", organisation_id: ORG });
  });

  it("sends anyone who is not an admin back to /admin", async () => {
    getCurrentProfile.mockResolvedValue({ id: "d", role: "clinician", organisation_id: ORG });
    await expect(render()).rejects.toThrow("NEXT_REDIRECT /admin");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks for real calls only by default and says test calls are hidden", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const html = await render();
    expect(rpc).toHaveBeenCalledWith("consultations_log", expect.objectContaining({ p_include_tests: false }));
    expect(html).toContain("Test calls are hidden");
  });

  it("shows the test call with include tests on: names, minutes, legs, a link to the member and the CSV link", async () => {
    rpc.mockResolvedValue({ data: [firstLiveCall], error: null });
    const html = await render({ tests: "1", from: "2026-11-03" });
    expect(rpc).toHaveBeenCalledWith("consultations_log", expect.objectContaining({ p_include_tests: true, p_from: "2026-11-03" }));
    expect(html).toContain(`href="/admin/members/${firstLiveCall.patient_id}"`);
    expect(html).toContain("k boss");
    expect(html).toContain("Kola Longe");
    expect(html).toContain("21.7");
    expect(html).toContain("8.7 (2 parts)");
    expect(html).toContain("Test");
    expect(html).toContain('href="/api/consultations-log/export?from=2026-11-03&amp;tests=1"');
  });

  it("says so when the log cannot be read, rather than showing an empty log", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const html = await render();
    expect(html).toContain("could not be loaded");
  });

  it("warns that the totals and CSV leave calls out when the row limit is reached", async () => {
    rpc.mockResolvedValue({ data: Array.from({ length: 1000 }, (_, i) => ({ ...firstLiveCall, encounter_id: `c861c6bb-b3e2-4ba8-b8b5-${String(i).padStart(12, "0")}` })), error: null });
    expect(await render({ tests: "1" })).toContain("Only the latest 1000 consultations are shown");
  });
});
