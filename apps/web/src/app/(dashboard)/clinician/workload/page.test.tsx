/** @jest-environment node */
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const staff = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: () => staff() }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: unknown) => s !== null }));
jest.mock("@/components/workload/workload-page", () => ({ WorkloadPage: (p: { days: number }) => `days:${p.days}` }));

import Page from "./page";

beforeEach(() => redirect.mockClear());

describe("/clinician/workload", () => {
  it("sends anyone who is not the clinical lead away", async () => {
    staff.mockResolvedValue(null);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/clinician");
  });
  it("shows the lead the dashboard for the chosen window, defaulting to 30 days", async () => {
    staff.mockResolvedValue({ doctor_tier: "chief_medical_officer" });
    expect(await Page({ searchParams: Promise.resolve({ days: "90" }) })).toEqual(expect.objectContaining({ props: expect.objectContaining({ days: 90 }) }));
    expect(await Page({ searchParams: Promise.resolve({ days: "nonsense" }) })).toEqual(expect.objectContaining({ props: expect.objectContaining({ days: 30 }) }));
  });
});
