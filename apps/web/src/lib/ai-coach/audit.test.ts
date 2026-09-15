import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { logAssistantTurn } from "./audit";
import { chainable } from "./test-support";

function fakeServiceRole(insertResult: unknown) {
  const insert = jest.fn((_payload: unknown) => chainable(insertResult));
  const from = jest.fn((_table: string) => ({ insert }));
  return { client: { from } as unknown as SupabaseClient<Database>, insert, from };
}

const BASE_PARAMS = {
  organisationId: "org-1",
  patientId: "pat-1",
  conversationId: "conv-1",
  interactionType: "chat_turn" as const,
  finalAction: "replied" as const,
  status: "completed" as const,
};

describe("logAssistantTurn", () => {
  it("writes to ai_assistant_turns and returns the new row's id on success", async () => {
    const { client, from, insert } = fakeServiceRole({ data: { id: "turn-1" }, error: null });

    const id = await logAssistantTurn(client, { ...BASE_PARAMS, modelId: "claude-sonnet-5" });

    expect(id).toBe("turn-1");
    expect(from).toHaveBeenCalledWith("ai_assistant_turns");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organisation_id: "org-1",
        patient_id: "pat-1",
        conversation_id: "conv-1",
        interaction_type: "chat_turn",
        model_id: "claude-sonnet-5",
        final_action: "replied",
        status: "completed",
      })
    );
  });

  it("defaults optional fields to null/[]/{} rather than undefined", async () => {
    const { client, insert } = fakeServiceRole({ data: { id: "turn-2" }, error: null });

    await logAssistantTurn(client, BASE_PARAMS);

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        model_id: null,
        prompt_version: null,
        safety_classification: null,
        retrieved_source_ids: [],
        clinician_alert_id: null,
        escalation_id: null,
        error_message: null,
        input_snapshot: {},
      })
    );
  });

  it("never throws and returns null when the insert errors", async () => {
    const { client } = fakeServiceRole({ data: null, error: { message: "boom" } });

    const id = await logAssistantTurn(client, BASE_PARAMS);

    expect(id).toBeNull();
  });

  it("never throws and returns null when the client itself throws", async () => {
    const client = {
      from: () => {
        throw new Error("connection reset");
      },
    } as unknown as SupabaseClient<Database>;

    const id = await logAssistantTurn(client, BASE_PARAMS);

    expect(id).toBeNull();
  });
});
