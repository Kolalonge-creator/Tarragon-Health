import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadThreadMessages } from "./care-messages";

type Client = SupabaseClient<Database>;

type MessageRow = {
  id: string;
  thread_id: string;
  actor_clinical_staff_id: string | null;
  attachments: unknown[];
  created_at: string;
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
 * directly (`clinical_staff!care_messages_actor_clinical_staff_id_fkey`),
 * which silently returned null for every patient once
 * 20260925015430_restrict_clinical_staff_patient_read_to_safe_columns.sql
 * narrowed clinical_staff's own RLS — meaning a patient reading their own
 * care-team thread could no longer tell which clinician sent a reply.
 * `loadThreadMessages` now issues a second, explicit query against
 * clinical_staff_directory and merges the result in application code.
 */
function stubClient(messages: MessageRow[], directory: DirectoryRow[]): Client {
  const messagesBuilder: Record<string, unknown> = {
    then: (resolve: (value: { data: MessageRow[]; error: null }) => unknown) =>
      Promise.resolve({ data: messages, error: null }).then(resolve),
  };
  for (const method of ["select", "eq", "order"]) {
    messagesBuilder[method] = () => messagesBuilder;
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
    from: (table: string) => (table === "clinical_staff_directory" ? directoryBuilder : messagesBuilder),
  } as unknown as Client;
}

describe("loadThreadMessages", () => {
  it("attaches the correct clinician actor to each message", async () => {
    const supabase = stubClient(
      [
        { id: "msg-1", thread_id: "t1", actor_clinical_staff_id: "staff-a", attachments: [], created_at: "2026-09-01T00:00:00Z" },
        { id: "msg-2", thread_id: "t1", actor_clinical_staff_id: "staff-b", attachments: [], created_at: "2026-09-02T00:00:00Z" },
      ],
      [
        { id: "staff-a", full_name: "Dr. A", credential_type: "MDCN", credential_number: "AAA", doctor_tier: "medical_officer" },
        { id: "staff-b", full_name: "Dr. B", credential_type: "MDCN", credential_number: "BBB", doctor_tier: "care_coordinator" },
      ]
    );

    const messages = await loadThreadMessages(supabase, "t1");

    expect(messages[0].actor?.full_name).toBe("Dr. A");
    expect(messages[1].actor?.full_name).toBe("Dr. B");
  });

  it("null-gates the actor for a patient/sponsor-authored message", async () => {
    const supabase = stubClient(
      [{ id: "msg-1", thread_id: "t1", actor_clinical_staff_id: null, attachments: [], created_at: "2026-09-01T00:00:00Z" }],
      []
    );

    const messages = await loadThreadMessages(supabase, "t1");

    expect(messages[0].actor).toBeNull();
  });
});
