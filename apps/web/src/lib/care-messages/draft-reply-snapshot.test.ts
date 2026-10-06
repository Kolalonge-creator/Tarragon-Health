import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  buildDraftReplySnapshot,
  formatDraftReplySnapshotForPrompt,
  type DraftReplySnapshot,
} from "./draft-reply-snapshot";

function snapshot(overrides: Partial<DraftReplySnapshot> = {}): DraftReplySnapshot {
  return {
    threadSubject: "Missed my BP reading this week",
    messages: [
      { authorRole: "patient", body: "Sorry, I've been travelling", createdAt: "2026-08-20T10:00:00.000Z" },
    ],
    ...overrides,
  };
}

describe("formatDraftReplySnapshotForPrompt", () => {
  it("includes the thread subject", () => {
    const text = formatDraftReplySnapshotForPrompt(snapshot());
    expect(text).toContain("Missed my BP reading this week");
  });

  it("says plainly when there are no messages yet, rather than omitting the line", () => {
    const text = formatDraftReplySnapshotForPrompt(snapshot({ messages: [] }));
    expect(text).toContain("No messages in this thread yet.");
  });

  it("labels each speaker by role and preserves oldest-first order", () => {
    const text = formatDraftReplySnapshotForPrompt(
      snapshot({
        messages: [
          { authorRole: "patient", body: "First message", createdAt: "2026-08-20T10:00:00.000Z" },
          { authorRole: "care_team", body: "Second message", createdAt: "2026-08-20T11:00:00.000Z" },
          { authorRole: "sponsor", body: "Third message", createdAt: "2026-08-20T12:00:00.000Z" },
        ],
      })
    );
    const firstIndex = text.indexOf("Patient: First message");
    const secondIndex = text.indexOf("Care team: Second message");
    const thirdIndex = text.indexOf("Supporter: Third message");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(thirdIndex).toBeGreaterThan(secondIndex);
  });
});

function clientWith(rpcResult: { data: unknown; error: { code: string; message: string } | null }) {
  const rpcCalls: string[] = [];
  const tables: string[] = [];
  const client = {
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return rpcResult;
    },
    from: (table: string) => {
      tables.push(table);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { subject: "Checking in" }, error: null }) }) }),
      };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, rpcCalls, tables };
}

describe("buildDraftReplySnapshot", () => {
  const row = (n: number) => ({
    id: `m${n}`,
    author_role: n % 2 ? "patient" : "care_team",
    body: `msg ${n}`,
    created_at: `2026-09-01T00:00:${String(n).padStart(2, "0")}Z`,
  });

  it("reads messages through the audited RPC, never the table, keeping the most recent 10 oldest first", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1));
    const { client, rpcCalls, tables } = clientWith({ data: rows, error: null });

    const snap = await buildDraftReplySnapshot(client, "t1");

    expect(rpcCalls).toEqual(["open_care_thread_audited"]);
    expect(tables).toEqual(["care_message_threads"]);
    expect(snap?.threadSubject).toBe("Checking in");
    expect(snap?.messages).toHaveLength(10);
    expect(snap?.messages[0].body).toBe("msg 3");
    expect(snap?.messages[9].body).toBe("msg 12");
  });

  it("returns null, without throwing, when the RPC fails", async () => {
    const { client } = clientWith({ data: null, error: { code: "42501", message: "no" } });
    await expect(buildDraftReplySnapshot(client, "t1")).resolves.toBeNull();
  });

  it("returns null when the RPC output is malformed", async () => {
    const { client } = clientWith({ data: [{ nope: true }], error: null });
    await expect(buildDraftReplySnapshot(client, "t1")).resolves.toBeNull();
  });
});
