/** recordConsent (S83 audit 1.4): giving and withdrawing an OPTIONAL consent from the app, append-only, never a required purpose. */
type Row = Record<string, unknown>;
const mockInserted: Row[] = [];
let mockCurrentVersion: { id: string; version: string; is_optional: boolean } | null;
let mockInsertError: { message: string } | null;

jest.mock("./supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "consent_versions") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockCurrentVersion, error: null }) }) }) }) };
      }
      return {
        insert: async (row: Row) => {
          mockInserted.push(row);
          return { error: mockInsertError };
        },
      };
    },
  },
}));

import { recordConsent } from "./privacy";

beforeEach(() => {
  mockInserted.length = 0;
  mockCurrentVersion = { id: "cv-1", version: "2026-10-07", is_optional: true };
  mockInsertError = null;
});

describe("recordConsent", () => {
  it("withdraws an optional consent by appending a withdrawn row against the current version", async () => {
    const r = await recordConsent("org-1", "p1", "research", "withdrawn");
    expect(r.ok).toBe(true);
    expect(mockInserted).toEqual([
      { organisation_id: "org-1", patient_id: "p1", consent_type: "research", consent_version_id: "cv-1", version: "2026-10-07", action: "withdrawn" },
    ]);
  });

  it("gives an optional consent as an accepted row", async () => {
    await recordConsent("org-1", "p1", "research", "accepted");
    expect(mockInserted[0]).toMatchObject({ action: "accepted", consent_type: "research" });
  });

  it("refuses a required purpose and writes nothing", async () => {
    mockCurrentVersion = { id: "cv-2", version: "v1", is_optional: false };
    const r = await recordConsent("org-1", "p1", "data_processing", "withdrawn");
    expect(r.ok).toBe(false);
    expect(mockInserted).toEqual([]);
  });

  it("refuses when there is no current version", async () => {
    mockCurrentVersion = null;
    expect((await recordConsent("org-1", "p1", "marketing", "accepted")).ok).toBe(false);
    expect(mockInserted).toEqual([]);
  });

  it("reports a failed write instead of pretending it worked", async () => {
    mockInsertError = { message: "rls" };
    expect((await recordConsent("org-1", "p1", "research", "accepted")).ok).toBe(false);
  });
});
