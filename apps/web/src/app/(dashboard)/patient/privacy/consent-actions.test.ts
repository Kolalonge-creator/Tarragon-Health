/**
 * Two-tap withdrawal (S04, function 1.15): optional purposes only, append-only, always the caller's own record.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const insertMock = jest.fn();
let versionRow: { id: string; version: string; is_optional: boolean } | null;
let user: { id: string } | null;

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
      }
      if (table === "consent_versions") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: versionRow }) }) }) }) };
      }
      if (table === "patient_consents") return { insert: (row: unknown) => insertMock(row) };
      throw new Error(`unexpected table ${table}`);
    },
  })),
}));

import { grantConsentAction, withdrawConsentAction } from "./consent-actions";

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ error: null });
  versionRow = { id: "cv-1", version: "v1", is_optional: true };
  user = { id: "patient-1" };
});

describe("withdrawConsentAction", () => {
  it("appends a withdrawn row for the caller on an optional purpose", async () => {
    const result = await withdrawConsentAction("research");
    expect(result).toEqual({ success: true });
    expect(insertMock).toHaveBeenCalledWith({
      organisation_id: "org-1",
      patient_id: "patient-1",
      consent_type: "research",
      consent_version_id: "cv-1",
      version: "v1",
      action: "withdrawn",
    });
  });

  it("refuses a required purpose and writes nothing", async () => {
    versionRow = { id: "cv-2", version: "v1", is_optional: false };
    const result = await withdrawConsentAction("data_processing");
    expect(result?.error).toMatch(/needed to use your account/i);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a consent type that is not in the enum", async () => {
    expect((await withdrawConsentAction("everything"))?.error).toBeTruthy();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("needs a signed-in caller", async () => {
    user = null;
    expect((await withdrawConsentAction("research"))?.error).toBeTruthy();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reports a database failure instead of pretending it worked", async () => {
    insertMock.mockResolvedValue({ error: { message: "boom" } });
    expect((await withdrawConsentAction("research"))?.error).toMatch(/could not record/i);
  });

  it("never takes the patient id from the caller", () => {
    expect(withdrawConsentAction.length).toBe(1);
  });
});

describe("grantConsentAction", () => {
  it("appends an accepted row for the caller on an optional purpose", async () => {
    const result = await grantConsentAction("research");
    expect(result).toEqual({ success: true });
    expect(insertMock).toHaveBeenCalledWith({
      organisation_id: "org-1",
      patient_id: "patient-1",
      consent_type: "research",
      consent_version_id: "cv-1",
      version: "v1",
      action: "accepted",
    });
  });

  it("refuses a required purpose here and writes nothing", async () => {
    versionRow = { id: "cv-2", version: "v1", is_optional: false };
    const result = await grantConsentAction("data_processing");
    expect(result?.error).toMatch(/set up your account/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses when signed out and when the type does not exist", async () => {
    user = null;
    expect((await grantConsentAction("research"))?.error).toMatch(/sign in/);
    user = { id: "patient-1" };
    expect((await grantConsentAction("not_a_type"))?.error).toMatch(/does not exist/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of pretending it worked", async () => {
    insertMock.mockResolvedValue({ error: { message: "rls" } });
    expect((await grantConsentAction("research"))?.error).toMatch(/could not record/);
  });
});
