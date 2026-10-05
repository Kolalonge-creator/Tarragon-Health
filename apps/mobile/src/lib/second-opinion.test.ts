import { loadMySecondOpinionRequests } from "./second-opinion";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));

const mockFrom = supabase.from as unknown as jest.Mock;

/**
 * Regression test for the 2026-09-25 fix: `answerer` used to be embedded
 * directly (`clinical_staff!second_opinion_requests_answered_by_fkey`),
 * which silently returned null for every patient once
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql
 * narrowed clinical_staff's own RLS. loadMySecondOpinionRequests now issues
 * a second, explicit query against clinical_staff_directory and merges the
 * result — mirrors apps/mobile/src/lib/messages.test.ts's pattern.
 */
function requestsTable(rows: unknown[]) {
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

describe("loadMySecondOpinionRequests", () => {
  it("attaches the correct clinician answerer to each request", async () => {
    const requests = [
      { id: "r-1", patient_id: "p1", answered_by: "staff-a", created_at: "2026-09-01T00:00:00Z" },
      { id: "r-2", patient_id: "p1", answered_by: "staff-b", created_at: "2026-09-02T00:00:00Z" },
    ];
    const directory = [
      { id: "staff-a", full_name: "Dr. A" },
      { id: "staff-b", full_name: "Dr. B" },
    ];
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory" ? directoryTable(directory) : requestsTable(requests)
    );

    const result = await loadMySecondOpinionRequests("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].answerer?.full_name).toBe("Dr. A");
    expect(result.data[1].answerer?.full_name).toBe("Dr. B");
  });

  it("null-gates the answerer for an unanswered request", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory"
        ? directoryTable([])
        : requestsTable([{ id: "r-1", patient_id: "p1", answered_by: null, created_at: "2026-09-01T00:00:00Z" }])
    );

    const result = await loadMySecondOpinionRequests("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].answerer).toBeNull();
  });
});
