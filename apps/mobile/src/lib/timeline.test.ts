import { loadPatientTimeline } from "./timeline";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));

const mockFrom = supabase.from as unknown as jest.Mock;

/**
 * Regression test for the 2026-09-25 fix: `actor` used to be embedded
 * directly (`clinical_staff!patient_timeline_actor_clinical_staff_id_fkey`),
 * which silently returned null for every patient once
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql
 * narrowed clinical_staff's own RLS. loadPatientTimeline now issues a
 * second, explicit query against clinical_staff_directory and merges the
 * result in application code — mirrors
 * apps/web/src/lib/queries/patient-timeline.test.ts.
 */
function timelineTable(rows: unknown[]) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  for (const method of ["select", "eq", "order", "range"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function directoryTable(rows: { id: string; full_name: string | null; doctor_tier: string | null }[]) {
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

describe("loadPatientTimeline", () => {
  it("attaches the correct clinician actor to each event", async () => {
    const events = [
      { id: "ev-1", patient_id: "p1", actor_clinical_staff_id: "staff-a", occurred_at: "2026-09-01T00:00:00Z" },
      { id: "ev-2", patient_id: "p1", actor_clinical_staff_id: "staff-b", occurred_at: "2026-09-02T00:00:00Z" },
    ];
    const directory = [
      { id: "staff-a", full_name: "Dr. A", doctor_tier: "medical_officer" },
      { id: "staff-b", full_name: "Dr. B", doctor_tier: "care_coordinator" },
    ];
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory" ? directoryTable(directory) : timelineTable(events)
    );

    const result = await loadPatientTimeline("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].actor?.full_name).toBe("Dr. A");
    expect(result.data[1].actor?.full_name).toBe("Dr. B");
  });

  it("null-gates the actor for an event with no acting clinician", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory"
        ? directoryTable([])
        : timelineTable([
            { id: "ev-1", patient_id: "p1", actor_clinical_staff_id: null, occurred_at: "2026-09-01T00:00:00Z" },
          ])
    );

    const result = await loadPatientTimeline("p1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].actor).toBeNull();
  });
});
