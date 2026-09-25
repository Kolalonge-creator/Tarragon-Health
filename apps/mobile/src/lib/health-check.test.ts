import { loadHealthCheckState } from "./health-check";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockFrom = supabase.from as unknown as jest.Mock;
const mockRpc = supabase.rpc as unknown as jest.Mock;

/**
 * Regression test for the 2026-09-25 fix: the annual health check's
 * `reviewerName` used to be read directly off `clinical_staff`, which
 * silently returned null for every patient once
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql
 * narrowed clinical_staff's own RLS to exclude patient sessions.
 * loadHealthCheckState now reads clinical_staff_directory instead.
 */
function chainable(result: { data: unknown; error?: unknown }) {
  const response = { data: result.data, error: result.error ?? null, count: Array.isArray(result.data) ? result.data.length : 0 };
  const builder: Record<string, unknown> = {
    then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
    maybeSingle: () => Promise.resolve({ data: result.data, error: result.error ?? null }),
  };
  for (const method of ["select", "eq", "gte", "in", "order"]) {
    builder[method] = () => builder;
  }
  return builder;
}

describe("loadHealthCheckState — reviewerName attribution", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  function mockTables(reviewedBy: string | null, directoryRows: { full_name: string }[]) {
    mockFrom.mockImplementation((table: string) => {
      if (table === "annual_health_checks") {
        return chainable({
          data: {
            created_at: "2026-01-01T00:00:00Z",
            reviewed_at: reviewedBy ? "2026-09-01T00:00:00Z" : null,
            reviewed_by: reviewedBy,
            review_summary: null,
            status: reviewedBy ? "reviewed" : "open",
            lab_order_id: null,
            lab_order: null,
            video_consult: null,
          },
        });
      }
      if (table === "clinical_staff_directory") {
        return chainable({ data: directoryRows[0] ?? null });
      }
      // prevention_risk_scores / mental_health_screens / vitals_readings / screening_schedules
      return chainable({ data: [] });
    });
  }

  it("reads the reviewer's name from clinical_staff_directory, not an unscoped clinical_staff read", async () => {
    mockTables("staff-a", [{ full_name: "A. Doctor" }]);

    const result = await loadHealthCheckState("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reviewerName).toBe("Dr. A. Doctor");
  });

  it("null-gates reviewerName for a not-yet-reviewed check", async () => {
    mockTables(null, []);

    const result = await loadHealthCheckState("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reviewerName).toBeNull();
  });
});
