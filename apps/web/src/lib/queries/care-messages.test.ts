import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadCareMessageScope, loadThreadMessages } from "./care-messages";

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
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

const NOT_AUTHORISED: RpcResult = { data: null, error: { code: "42501", message: "not authorised for this thread" } };

function stubClient(
  messages: MessageRow[],
  directory: DirectoryRow[],
  rpcResult?: RpcResult,
  calls: { rpc: string[]; from: string[] } = { rpc: [], from: [] }
): Client {
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
    // Default: the audited RPC succeeds and returns the same rows the table would.
    rpc: async (fn: string) => {
      calls.rpc.push(fn);
      return rpcResult ?? { data: messages, error: null };
    },
    from: (table: string) => {
      calls.from.push(table);
      return table === "clinical_staff_directory" ? directoryBuilder : messagesBuilder;
    },
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

  it("maps the audited RPC rows and their attachments without touching the care_messages table", async () => {
    const calls = { rpc: [] as string[], from: [] as string[] };
    const supabase = stubClient(
      [
        {
          id: "msg-1",
          thread_id: "t1",
          actor_clinical_staff_id: "staff-a",
          attachments: [{ id: "att-1", file_path: "p/1.png" }],
          created_at: "2026-09-01T00:00:00Z",
        },
        { id: "msg-2", thread_id: "t1", actor_clinical_staff_id: null, attachments: [], created_at: "2026-09-02T00:00:00Z" },
      ],
      [{ id: "staff-a", full_name: "Dr. A", credential_type: null, credential_number: null, doctor_tier: "medical_officer" }],
      undefined,
      calls
    );

    const messages = await loadThreadMessages(supabase, "t1");

    expect(calls.rpc).toEqual(["open_care_thread_audited"]);
    expect(calls.from).not.toContain("care_messages");
    expect(messages.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].actor?.full_name).toBe("Dr. A");
    expect(messages[1].actor).toBeNull();
  });

  it("falls back to the direct query on 42501 (supporter or break-glass reader)", async () => {
    const calls = { rpc: [] as string[], from: [] as string[] };
    const supabase = stubClient(
      [{ id: "msg-9", thread_id: "t1", actor_clinical_staff_id: null, attachments: [], created_at: "2026-09-01T00:00:00Z" }],
      [],
      NOT_AUTHORISED,
      calls
    );

    const messages = await loadThreadMessages(supabase, "t1");

    expect(calls.from).toContain("care_messages");
    expect(messages.map((m) => m.id)).toEqual(["msg-9"]);
  });

  it("rethrows any other RPC error rather than falling back", async () => {
    const calls = { rpc: [] as string[], from: [] as string[] };
    const boom = { code: "XX000", message: "boom" };
    const supabase = stubClient([], [], { data: null, error: boom }, calls);

    await expect(loadThreadMessages(supabase, "t1")).rejects.toBe(boom);
    expect(calls.from).not.toContain("care_messages");
  });
});

describe("loadCareMessageScope", () => {
  const scope = { organisation_id: "o1", patient_id: "p1", thread_id: "t1" };

  function scopeClient(rpcResult: RpcResult, direct: { data: unknown; error: unknown }, calls: string[]): Client {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.single = async () => direct;
    return {
      rpc: async (fn: string) => {
        calls.push(`rpc:${fn}`);
        return rpcResult;
      },
      from: (table: string) => {
        calls.push(`from:${table}`);
        return builder;
      },
    } as unknown as Client;
  }

  it("uses care_message_scope", async () => {
    const calls: string[] = [];
    const out = await loadCareMessageScope(scopeClient({ data: scope, error: null }, { data: null, error: null }, calls), "m1");
    expect(out).toEqual(scope);
    expect(calls).toEqual(["rpc:care_message_scope"]);
  });

  it("falls back to the direct read on 42501", async () => {
    const calls: string[] = [];
    const out = await loadCareMessageScope(scopeClient(NOT_AUTHORISED, { data: scope, error: null }, calls), "m1");
    expect(out).toEqual(scope);
    expect(calls).toEqual(["rpc:care_message_scope", "from:care_messages"]);
  });

  it("rethrows another error", async () => {
    const calls: string[] = [];
    const boom = { code: "P0002", message: "not found" };
    await expect(
      loadCareMessageScope(scopeClient({ data: null, error: boom }, { data: scope, error: null }, calls), "m1")
    ).rejects.toBe(boom);
    expect(calls).toEqual(["rpc:care_message_scope"]);
  });
});
