import { loadMySeniorCaseReviews } from "./senior-case-review";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));

const mockFrom = supabase.from as unknown as jest.Mock;

/**
 * Regression test for the 2026-09-25 fix: `reviewer` used to be embedded
 * directly (`clinical_staff!senior_case_reviews_reviewed_by_fkey`), which
 * silently returned null for every patient once
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql
 * narrowed clinical_staff's own RLS. loadMySeniorCaseReviews now issues a
 * second, explicit query against clinical_staff_directory and merges the
 * result — mirrors apps/mobile/src/lib/messages.test.ts's pattern.
 */
function reviewsTable(rows: unknown[]) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function directoryTable(rows: { id: string; full_name: string | null }[]) {
  let requestedIds: string[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows.filter((r) => requestedIds.includes(r.id)), error: null }).then(resolve),
  };
  builder.select = () => builder;
  builder.in = (_column: string, ids: string[]) => {
    requestedIds = ids;
    return builder;
  };
  return builder;
}

describe("loadMySeniorCaseReviews", () => {
  it("attaches the correct clinician reviewer to each review", async () => {
    const reviews = [
      { id: "rev-1", patient_id: "p1", reviewed_by: "staff-a", created_at: "2026-09-01T00:00:00Z" },
      { id: "rev-2", patient_id: "p1", reviewed_by: "staff-b", created_at: "2026-09-02T00:00:00Z" },
    ];
    const directory = [
      { id: "staff-a", full_name: "Dr. A" },
      { id: "staff-b", full_name: "Dr. B" },
    ];
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory" ? directoryTable(directory) : reviewsTable(reviews)
    );

    const result = await loadMySeniorCaseReviews("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].reviewer?.full_name).toBe("Dr. A");
    expect(result.data[1].reviewer?.full_name).toBe("Dr. B");
  });

  it("null-gates the reviewer for an undecided review", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory"
        ? directoryTable([])
        : reviewsTable([{ id: "rev-1", patient_id: "p1", reviewed_by: null, created_at: "2026-09-01T00:00:00Z" }])
    );

    const result = await loadMySeniorCaseReviews("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].reviewer).toBeNull();
  });
});
