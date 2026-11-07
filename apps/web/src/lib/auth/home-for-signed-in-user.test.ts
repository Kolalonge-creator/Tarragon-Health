import { CMO_HOME_PATH, homeForSignedInUser } from "./home-for-signed-in-user";

/** The CMO lands on the Clinical Leadership Overview (founder decision 2026-11-07); nobody else's landing changes. */
function stub(staff: { doctor_tier: string | null; active: boolean } | null, error: unknown = null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: staff, error });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, from };
}

describe("homeForSignedInUser", () => {
  it("sends an active Chief Medical Officer to the Leadership overview", async () => {
    const { client } = stub({ doctor_tier: "chief_medical_officer", active: true });
    await expect(homeForSignedInUser(client, "u1", "clinician")).resolves.toBe(CMO_HOME_PATH);
  });

  it("keeps an inactive CMO, another doctor, or an unreadable tier on the clinician home", async () => {
    await expect(homeForSignedInUser(stub({ doctor_tier: "chief_medical_officer", active: false }).client, "u1", "clinician")).resolves.toBe("/clinician");
    await expect(homeForSignedInUser(stub({ doctor_tier: "senior_medical_officer", active: true }).client, "u1", "clinician")).resolves.toBe("/clinician");
    await expect(homeForSignedInUser(stub(null).client, "u1", "clinician")).resolves.toBe("/clinician");
    await expect(homeForSignedInUser(stub({ doctor_tier: "chief_medical_officer", active: true }, { message: "x" }).client, "u1", "clinician")).resolves.toBe("/clinician");
  });

  it("does not read clinical_staff for other roles", async () => {
    const { client, from } = stub(null);
    await expect(homeForSignedInUser(client, "u1", "patient")).resolves.toBe("/patient");
    expect(from).not.toHaveBeenCalled();
  });
});
