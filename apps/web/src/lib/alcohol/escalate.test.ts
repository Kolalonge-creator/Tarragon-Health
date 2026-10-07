/**
 * Regression (S56 review): the hazardous-alcohol alert named "AUDIT-C" and the score in a clinician_alerts row that every org staff
 * account (and a Care Circle supporter holding only medical_history) can read, and a failed insert was silently discarded.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const insert = jest.fn<(row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>>();
let openAlert: { id: string } | null = null;

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: openAlert }) }) }) }) }),
      insert,
    }),
  }),
}));

import { ALCOHOL_ALERT_DETAIL, ALCOHOL_ALERT_TITLE, flagHazardousAlcoholUse } from "./escalate";

beforeEach(() => {
  insert.mockReset();
  openAlert = null;
});

describe("flagHazardousAlcoholUse", () => {
  it("raises an alert whose text names no instrument, score or alcohol wording", async () => {
    insert.mockResolvedValue({ error: null });
    await flagHazardousAlcoholUse("p1", "o1");
    const row = insert.mock.calls[0]?.[0] ?? {};
    const text = `${String(row.title)} ${String(row.detail)}`;
    expect(row.title).toBe(ALCOHOL_ALERT_TITLE);
    expect(row.detail).toBe(ALCOHOL_ALERT_DETAIL);
    expect(text).not.toMatch(/audit|alcohol|\b9\b|hazardous/i);
  });
  it("does not raise a second alert while one is open", async () => {
    openAlert = { id: "a1" };
    await flagHazardousAlcoholUse("p1", "o1");
    expect(insert).not.toHaveBeenCalled();
  });
  it("throws when the insert fails, so the caller can report it instead of losing a hazardous result", async () => {
    insert.mockResolvedValue({ error: { message: "boom" } });
    await expect(flagHazardousAlcoholUse("p1", "o1")).rejects.toThrow(/boom/);
  });
});
