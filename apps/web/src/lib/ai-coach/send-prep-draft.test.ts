/**
 * Found in review (S51): the conversation id came from the client and was used to write a handoff event without checking it belonged to
 * the caller; and the prep-draft send and handoff were outside the assistant_enabled guard (INV-14).
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

const emitAssistantEvent = jest.fn(async () => true);
const isAssistantOpen = jest.fn(async () => true);
jest.mock("./events", () => ({ emitAssistantEvent }));
jest.mock("./guard", () => ({ isAssistantOpen }));

import { sendApprovedPrepDraft } from "./send-prep-draft";

const MINE = "7b1a6f2e-6f0d-4e8e-9f55-0c6a3b2f9c11";
const THEIRS = "0c6a3b2f-9c11-4e8e-9f55-7b1a6f2e6f0d";

function client() {
  const rpc = jest.fn(async () => ({ data: "thread-1", error: null }));
  const from = jest.fn(() => {
    const filters: Record<string, string> = {};
    const q = {
      select: () => q,
      eq: (c: string, v: string) => {
        filters[c] = v;
        return q;
      },
      // RLS plus the explicit owner filter: only the caller's own conversation is ever found
      maybeSingle: async () => ({ data: filters.id === MINE && filters.profile_id === "me" ? { id: MINE } : null, error: null }),
    };
    return q;
  });
  return { supabase: { rpc, from } as unknown as SupabaseClient<Database>, rpc };
}
const text = "Please look at my blood pressure readings before the visit.";
const deps = (supabase: SupabaseClient<Database>) => ({
  supabase,
  getServiceRoleSupabase: () => ({}) as unknown as SupabaseClient<Database>,
  profileId: "me",
  organisationId: "o1",
});

describe("sending an approved prep draft", () => {
  it("refuses another patient's conversation id: nothing is sent and no event is written", async () => {
    const { supabase, rpc } = client();
    emitAssistantEvent.mockClear();
    const out = await sendApprovedPrepDraft({ ...deps(supabase), input: { text, conversationId: THEIRS } });
    expect(out.success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(emitAssistantEvent).not.toHaveBeenCalled();
  });

  it("sends and records the handoff for the caller's own conversation", async () => {
    const { supabase, rpc } = client();
    emitAssistantEvent.mockClear();
    const out = await sendApprovedPrepDraft({ ...deps(supabase), input: { text, conversationId: MINE } });
    expect(out.success).toBe(true);
    expect(rpc.mock.calls.length).toBe(1);
    expect(emitAssistantEvent).toHaveBeenCalledTimes(1);
  });

  it("is closed while the assistant_enabled guard is closed", async () => {
    isAssistantOpen.mockResolvedValueOnce(false);
    const { supabase, rpc } = client();
    const out = await sendApprovedPrepDraft({ ...deps(supabase), input: { text } });
    expect(out.success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
