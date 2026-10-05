import { loadThreadMessages } from "./messages";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

const mockFrom = supabase.from as unknown as jest.Mock;

/**
 * Regression test for the 2026-09-25 fix: `actor` used to be embedded
 * directly (`clinical_staff!care_messages_actor_clinical_staff_id_fkey`),
 * which silently returned null for every patient once
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql
 * narrowed clinical_staff's own RLS. loadThreadMessages now issues a second,
 * explicit query against clinical_staff_directory and merges the result in
 * application code — mirrors apps/web/src/lib/queries/care-messages.test.ts.
 */
function messagesTable(rows: unknown[]) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  for (const method of ["select", "eq", "order"]) {
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

describe("loadThreadMessages", () => {
  it("attaches the correct clinician actor to each message", async () => {
    const messages = [
      { id: "msg-1", thread_id: "t1", actor_clinical_staff_id: "staff-a", created_at: "2026-09-01T00:00:00Z" },
      { id: "msg-2", thread_id: "t1", actor_clinical_staff_id: "staff-b", created_at: "2026-09-02T00:00:00Z" },
    ];
    const directory = [
      { id: "staff-a", full_name: "Dr. A" },
      { id: "staff-b", full_name: "Dr. B" },
    ];
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory" ? directoryTable(directory) : messagesTable(messages)
    );

    const result = await loadThreadMessages("t1");

    expect(result[0].actor?.full_name).toBe("Dr. A");
    expect(result[1].actor?.full_name).toBe("Dr. B");
  });

  it("null-gates the actor for a patient/sponsor-authored message", async () => {
    mockFrom.mockImplementation((table: string) =>
      table === "clinical_staff_directory"
        ? directoryTable([])
        : messagesTable([
            { id: "msg-1", thread_id: "t1", actor_clinical_staff_id: null, created_at: "2026-09-01T00:00:00Z" },
          ])
    );

    const result = await loadThreadMessages("t1");

    expect(result[0].actor).toBeNull();
  });
});
