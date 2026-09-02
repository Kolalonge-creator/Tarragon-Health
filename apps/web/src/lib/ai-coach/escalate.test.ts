import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { logAiCoachEscalation, logAiCoachReviewFlag } from "./escalate";
import { chainable } from "./test-support";

const PARAMS = {
  organisationId: "org-1",
  patientId: "pat-1",
  conversationId: "conv-1",
  triggerMessage: "I have crushing chest pain",
};

function fakeServiceRole() {
  const insertedTables: string[] = [];
  const from = jest.fn((table: string) => {
    insertedTables.push(table);
    if (table === "clinician_alerts") return chainable({ data: { id: "alert-1" }, error: null });
    if (table === "escalations") return chainable({ data: { id: "escalation-1" }, error: null });
    return chainable({ data: null, error: null });
  });
  return { client: { from } as unknown as SupabaseClient<Database>, insertedTables, from };
}

describe("logAiCoachEscalation", () => {
  it("opens a care_messages thread via the patient's own session, linked to the new escalation", async () => {
    const rpc = jest.fn(async (..._args: unknown[]) => ({ data: "thread-1", error: null }));
    const patientSupabase = { rpc } as unknown as SupabaseClient<Database>;
    const { client: serviceRole } = fakeServiceRole();

    const result = await logAiCoachEscalation(patientSupabase, serviceRole, PARAMS);

    expect(result).toEqual({
      clinicianAlertId: "alert-1",
      escalationId: "escalation-1",
      careMessageThreadId: "thread-1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "start_care_thread",
      expect.objectContaining({
        p_escalation_id: "escalation-1",
        p_subject: expect.any(String),
        p_body: expect.stringContaining("I have crushing chest pain"),
      })
    );
  });

  it("still returns the alert/escalation ids when opening the thread fails (best-effort)", async () => {
    const rpc = jest.fn(async () => ({ data: null, error: { message: "not authorised" } }));
    const patientSupabase = { rpc } as unknown as SupabaseClient<Database>;
    const { client: serviceRole } = fakeServiceRole();

    const result = await logAiCoachEscalation(patientSupabase, serviceRole, PARAMS);

    expect(result.clinicianAlertId).toBe("alert-1");
    expect(result.escalationId).toBe("escalation-1");
    expect(result.careMessageThreadId).toBeNull();
  });

  it("still returns the alert/escalation ids when the rpc call itself throws", async () => {
    const patientSupabase = {
      rpc: () => {
        throw new Error("network down");
      },
    } as unknown as SupabaseClient<Database>;
    const { client: serviceRole } = fakeServiceRole();

    const result = await logAiCoachEscalation(patientSupabase, serviceRole, PARAMS);

    expect(result.clinicianAlertId).toBe("alert-1");
    expect(result.escalationId).toBe("escalation-1");
    expect(result.careMessageThreadId).toBeNull();
  });
});

describe("logAiCoachReviewFlag", () => {
  it("does not attempt to open a care_messages thread (no escalations row to link it to)", async () => {
    const { client: serviceRole } = fakeServiceRole();

    const result = await logAiCoachReviewFlag(serviceRole, PARAMS);

    expect(result).toEqual({ clinicianAlertId: "alert-1" });
  });
});
