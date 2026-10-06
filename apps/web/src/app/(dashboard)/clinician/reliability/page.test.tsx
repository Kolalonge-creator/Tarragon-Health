/** @jest-environment node */
const redirect = jest.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const staff = jest.fn();
jest.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: () => staff(), getCurrentProfile: async () => ({ language: "en" }) }));
jest.mock("@/lib/clinical/doctor-tier", () => ({ canAssignCases: (s: unknown) => s !== null }));
jest.mock("@/lib/language/pidgin-switch", () => ({ getPidginEnabled: async () => false }));
jest.mock("@/components/reliability/reliability-page", () => ({ ReliabilityPage: (p: { viewer: string }) => `viewer:${p.viewer}` }));

import Page from "./page";

beforeEach(() => redirect.mockClear());

describe("/clinician/reliability", () => {
  it("sends anyone who is not the clinical lead away", async () => {
    staff.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("REDIRECT:/clinician");
  });
  it("shows the lead the named view", async () => {
    staff.mockResolvedValue({ doctor_tier: "chief_medical_officer" });
    expect(await Page()).toEqual(expect.objectContaining({ props: expect.objectContaining({ viewer: "lead" }) }));
  });
});
