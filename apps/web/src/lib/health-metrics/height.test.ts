import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { fetchHeightStatus } from "./height";

/** Minimal chainable Supabase query-builder mock — every chain method
 * returns the same object so calls compose in any order; `.maybeSingle()`
 * resolves to the canned result. */
function chainable<T>(result: T) {
  const obj: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    obj[method] = jest.fn(() => obj);
  }
  obj.maybeSingle = jest.fn(async () => result);
  return obj;
}

function fakeSupabase(
  profileResult: { height_cm: number | null; height_reconciled_at: string | null } | null,
  answerResult: { response: unknown; created_at: string } | null
) {
  const from = jest.fn((table: string) => {
    if (table === "profiles") return chainable({ data: profileResult, error: null });
    if (table === "risk_assessment_responses") return chainable({ data: answerResult, error: null });
    throw new Error(`unexpected table: ${table}`);
  });
  return { from } as unknown as SupabaseClient<Database>;
}

describe("fetchHeightStatus", () => {
  it("returns null with no discrepancy when neither source has a height", async () => {
    const supabase = fakeSupabase(null, null);
    const status = await fetchHeightStatus(supabase, "pat-1");
    expect(status).toEqual({ heightCm: null, discrepancy: null });
  });

  it("falls back to the questionnaire answer when no profile height is on file", async () => {
    const supabase = fakeSupabase(null, { response: 170, created_at: "2026-01-01T00:00:00Z" });
    const status = await fetchHeightStatus(supabase, "pat-1");
    expect(status).toEqual({ heightCm: 170, discrepancy: null });
  });

  it("prefers the profile height when no questionnaire answer exists", async () => {
    const supabase = fakeSupabase({ height_cm: 175, height_reconciled_at: null }, null);
    const status = await fetchHeightStatus(supabase, "pat-1");
    expect(status).toEqual({ heightCm: 175, discrepancy: null });
  });

  it("treats a sub-tolerance difference as agreement, not a discrepancy", async () => {
    const supabase = fakeSupabase(
      { height_cm: 170, height_reconciled_at: null },
      { response: 170.2, created_at: "2026-01-01T00:00:00Z" }
    );
    const status = await fetchHeightStatus(supabase, "pat-1");
    expect(status).toEqual({ heightCm: 170, discrepancy: null });
  });

  it("flags a real disagreement that has never been reconciled", async () => {
    const supabase = fakeSupabase(
      { height_cm: 175, height_reconciled_at: null },
      { response: 170, created_at: "2026-01-01T00:00:00Z" }
    );
    const status = await fetchHeightStatus(supabase, "pat-1");
    expect(status).toEqual({
      heightCm: 175,
      discrepancy: {
        profileHeightCm: 175,
        questionnaireHeightCm: 170,
        questionnaireAnsweredAt: "2026-01-01T00:00:00Z",
      },
    });
  });

  it("stays resolved once the patient has reconciled that exact answer", async () => {
    const supabase = fakeSupabase(
      { height_cm: 175, height_reconciled_at: "2026-01-02T00:00:00Z" },
      { response: 170, created_at: "2026-01-01T00:00:00Z" }
    );
    const status = await fetchHeightStatus(supabase, "pat-1");
    expect(status).toEqual({ heightCm: 175, discrepancy: null });
  });

  it("re-flags when a later questionnaire retake disagrees again after a past reconciliation", async () => {
    const supabase = fakeSupabase(
      { height_cm: 175, height_reconciled_at: "2026-01-01T00:00:00Z" },
      { response: 168, created_at: "2026-02-01T00:00:00Z" }
    );
    const status = await fetchHeightStatus(supabase, "pat-1");
    expect(status.discrepancy).toEqual({
      profileHeightCm: 175,
      questionnaireHeightCm: 168,
      questionnaireAnsweredAt: "2026-02-01T00:00:00Z",
    });
  });
});
