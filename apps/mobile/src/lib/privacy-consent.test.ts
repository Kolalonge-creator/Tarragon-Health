/** loadConsentStatus (S04): a withdrawn consent is not "accepted", and an optional purpose that was never answered is "Not shared", not outstanding. */
let mockVersionsRows: unknown[] = [];
let mockEventRows: unknown[] = [];

jest.mock("./supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, _v: unknown) => {
          const rows = table === "consent_versions" ? mockVersionsRows : mockEventRows;
          const result = Promise.resolve({ data: rows, error: null });
          (result as unknown as { order: () => Promise<unknown> }).order = () => Promise.resolve({ data: rows, error: null });
          return result;
        },
      }),
    }),
  },
}));

import { loadConsentStatus } from "./privacy";

const ev = (type: string, action: string, at: string) => ({ consent_type: type, version: "v1", accepted_at: at, action, created_at: at });

describe("loadConsentStatus", () => {
  it("reports granted, withdrawn and never-answered correctly", async () => {
    mockVersionsRows = [
      { consent_type: "data_processing", version: "v1", is_required: true },
      { consent_type: "telehealth", version: "v1", is_required: true },
      { consent_type: "research", version: "v1", is_required: false },
    ];
    mockEventRows = [
      ev("data_processing", "accepted", "2026-10-01T10:00:00Z"),
      ev("telehealth", "accepted", "2026-10-01T10:00:00Z"),
      ev("telehealth", "withdrawn", "2026-10-02T10:00:00Z"),
    ];
    const result = await loadConsentStatus("p1");
    if (!result.ok) throw new Error("expected ok");
    const byType = Object.fromEntries(result.data.map((r) => [r.consentType, r]));
    expect(byType.data_processing).toMatchObject({ accepted: true, state: "granted", isRequired: true });
    expect(byType.telehealth).toMatchObject({ accepted: false, state: "withdrawn", acceptedAt: null });
    expect(byType.research).toMatchObject({ accepted: false, state: "never", isRequired: false });
  });
});
