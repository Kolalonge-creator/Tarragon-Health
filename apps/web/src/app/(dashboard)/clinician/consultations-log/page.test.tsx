import { describe, expect, it, jest } from "@jest/globals";

const getCurrentClinicalStaff = jest.fn<() => Promise<unknown>>();
const rpc = jest.fn<(name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>();
jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: async () => ({ id: "c", role: "clinician", organisation_id: "00000000-0000-0000-0000-000000000001" }),
  getCurrentClinicalStaff: () => getCurrentClinicalStaff(),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const chain = { select: () => chain, eq: () => chain, not: () => chain, order: async () => ({ data: [], error: null }) };
    return { rpc: (n: string, a: unknown) => rpc(n, a), from: () => chain };
  },
}));
jest.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import ClinicianConsultationsLogPage from "./page";
import { firstLiveCall } from "@/lib/consultations/consultations-log.fixture";

describe("/clinician/consultations-log", () => {
  it("sends a doctor who is not the CMO back to /clinician", async () => {
    getCurrentClinicalStaff.mockResolvedValue({ doctor_tier: "senior_medical_officer", active: true });
    await expect(ClinicianConsultationsLogPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT /clinician");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the CMO the log, each patient linking to the clinician record", async () => {
    getCurrentClinicalStaff.mockResolvedValue({ doctor_tier: "chief_medical_officer", active: true });
    rpc.mockResolvedValue({ data: [firstLiveCall], error: null });
    const html = renderToStaticMarkup(await ClinicianConsultationsLogPage({ searchParams: Promise.resolve({ tests: "1" }) }));
    expect(html).toContain(`href="/clinician/patients/${firstLiveCall.patient_id}"`);
    expect(html).toContain('action="/clinician/consultations-log"');
  });
});
