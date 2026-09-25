import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadPatientTimeline } from "./patient-timeline";

type Client = SupabaseClient<Database>;

type TimelineRow = {
  id: string;
  patient_id: string;
  actor_clinical_staff_id: string | null;
  occurred_at: string;
};

type DirectoryRow = {
  id: string;
  full_name: string | null;
  credential_type: string | null;
  credential_number: string | null;
  doctor_tier: string | null;
};

/**
 * Regression test for the 2026-09-25 fix: `actor` used to be embedded
 * directly (`clinical_staff!patient_timeline_actor_clinical_staff_id_fkey`),
 * which silently returned null for every patient once
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql
 * narrowed clinical_staff's own RLS. `loadPatientTimeline` now issues a
 * second, explicit query against clinical_staff_directory and merges the
 * result in application code — this proves that merge actually attaches the
 * right actor to the right row (not just "some" actor), including when two
 * timeline rows share the same actor and when a row has no actor at all.
 */
function stubClient(timeline: TimelineRow[], directory: DirectoryRow[]): Client {
  const timelineBuilder: Record<string, unknown> = {
    then: (resolve: (value: { data: TimelineRow[]; error: null }) => unknown) =>
      Promise.resolve({ data: timeline, error: null }).then(resolve),
  };
  for (const method of ["select", "eq", "order", "range"]) {
    timelineBuilder[method] = () => timelineBuilder;
  }

  let requestedIds: string[] = [];
  const directoryBuilder: Record<string, unknown> = {
    then: (resolve: (value: { data: DirectoryRow[]; error: null }) => unknown) =>
      Promise.resolve({ data: directory.filter((row) => requestedIds.includes(row.id)), error: null }).then(
        resolve
      ),
  };
  directoryBuilder.select = () => directoryBuilder;
  directoryBuilder.in = (_column: string, ids: string[]) => {
    requestedIds = ids;
    return directoryBuilder;
  };

  return {
    from: (table: string) => (table === "clinical_staff_directory" ? directoryBuilder : timelineBuilder),
  } as unknown as Client;
}

describe("loadPatientTimeline", () => {
  it("attaches the correct actor to each row, not just any actor", async () => {
    const supabase = stubClient(
      [
        { id: "evt-1", patient_id: "p1", actor_clinical_staff_id: "staff-a", occurred_at: "2026-09-01T00:00:00Z" },
        { id: "evt-2", patient_id: "p1", actor_clinical_staff_id: "staff-b", occurred_at: "2026-08-01T00:00:00Z" },
      ],
      [
        { id: "staff-a", full_name: "Dr. A", credential_type: "MDCN", credential_number: "AAA", doctor_tier: "medical_officer" },
        { id: "staff-b", full_name: "Dr. B", credential_type: "MDCN", credential_number: "BBB", doctor_tier: "senior_medical_officer" },
      ]
    );

    const events = await loadPatientTimeline(supabase, "p1", 50, 0);

    expect(events).toHaveLength(2);
    expect(events[0].actor?.full_name).toBe("Dr. A");
    expect(events[1].actor?.full_name).toBe("Dr. B");
  });

  it("null-gates the actor when a row has no acting clinician, rather than borrowing another row's actor", async () => {
    const supabase = stubClient(
      [
        { id: "evt-1", patient_id: "p1", actor_clinical_staff_id: "staff-a", occurred_at: "2026-09-01T00:00:00Z" },
        { id: "evt-2", patient_id: "p1", actor_clinical_staff_id: null, occurred_at: "2026-08-01T00:00:00Z" },
      ],
      [{ id: "staff-a", full_name: "Dr. A", credential_type: "MDCN", credential_number: "AAA", doctor_tier: "medical_officer" }]
    );

    const events = await loadPatientTimeline(supabase, "p1", 50, 0);

    expect(events[0].actor).not.toBeNull();
    expect(events[1].actor).toBeNull();
  });

  it("deduplicates repeat actors into a single follow-up query, and both rows still resolve", async () => {
    const supabase = stubClient(
      [
        { id: "evt-1", patient_id: "p1", actor_clinical_staff_id: "staff-a", occurred_at: "2026-09-02T00:00:00Z" },
        { id: "evt-2", patient_id: "p1", actor_clinical_staff_id: "staff-a", occurred_at: "2026-09-01T00:00:00Z" },
      ],
      [{ id: "staff-a", full_name: "Dr. A", credential_type: "MDCN", credential_number: "AAA", doctor_tier: "medical_officer" }]
    );

    const events = await loadPatientTimeline(supabase, "p1", 50, 0);

    expect(events[0].actor?.full_name).toBe("Dr. A");
    expect(events[1].actor?.full_name).toBe("Dr. A");
  });

  it("never crashes when an actor id has no matching clinical_staff_directory row", async () => {
    const supabase = stubClient(
      [{ id: "evt-1", patient_id: "p1", actor_clinical_staff_id: "staff-missing", occurred_at: "2026-09-01T00:00:00Z" }],
      []
    );

    const events = await loadPatientTimeline(supabase, "p1", 50, 0);

    expect(events[0].actor).toBeNull();
  });
});
