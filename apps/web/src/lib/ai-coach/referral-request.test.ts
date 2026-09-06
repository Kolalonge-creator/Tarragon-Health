import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { requestSpecialistReferral } from "./referral-request";
import { chainable } from "./test-support";

const PARAMS = {
  organisationId: "org-1",
  patientId: "pat-1",
  conversationId: "conv-1",
  specialistType: "cardiology" as const,
  reason: "I've been having chest tightness on exertion",
};

function fakeServiceRole() {
  const insertedRows: { table: string; payload: unknown }[] = [];
  const from = jest.fn((table: string) => ({
    insert: jest.fn((payload: unknown) => {
      insertedRows.push({ table, payload });
      if (table === "clinician_alerts") return chainable({ data: { id: "alert-1" }, error: null });
      return chainable({ data: null, error: null });
    }),
  }));
  return { client: { from } as unknown as SupabaseClient<Database>, from, insertedRows };
}

describe("requestSpecialistReferral", () => {
  it("writes a clinician_alerts row with category='care_management' and type_code='referral_requested'", async () => {
    const rpc = jest.fn(async () => ({ data: "thread-1", error: null }));
    const patientSupabase = { rpc } as unknown as SupabaseClient<Database>;
    const { client: serviceRole, insertedRows } = fakeServiceRole();

    const result = await requestSpecialistReferral(patientSupabase, serviceRole, PARAMS);

    expect(result).toEqual({ clinicianAlertId: "alert-1", careMessageThreadId: "thread-1" });
    const alertInsert = insertedRows.find((r) => r.table === "clinician_alerts");
    expect(alertInsert?.payload).toEqual(
      expect.objectContaining({
        organisation_id: "org-1",
        patient_id: "pat-1",
        level: "clinician_review",
        category: "care_management",
        type_code: "referral_requested",
      })
    );
  });

  it("opens an unlinked care_messages thread (no p_escalation_id) -- a referral request never creates an escalations row", async () => {
    const rpc = jest.fn(async (..._args: unknown[]) => ({ data: "thread-1", error: null }));
    const patientSupabase = { rpc } as unknown as SupabaseClient<Database>;
    const { client: serviceRole } = fakeServiceRole();

    await requestSpecialistReferral(patientSupabase, serviceRole, PARAMS);

    expect(rpc).toHaveBeenCalledWith(
      "start_care_thread",
      expect.objectContaining({
        p_subject: expect.stringContaining("cardiology"),
        p_body: expect.stringContaining("cardiology"),
      })
    );
    const callArgs = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("p_escalation_id");
  });

  it("still returns the alert id when opening the thread fails (best-effort)", async () => {
    const rpc = jest.fn(async () => ({ data: null, error: { message: "not authorised" } }));
    const patientSupabase = { rpc } as unknown as SupabaseClient<Database>;
    const { client: serviceRole } = fakeServiceRole();

    const result = await requestSpecialistReferral(patientSupabase, serviceRole, PARAMS);

    expect(result.clinicianAlertId).toBe("alert-1");
    expect(result.careMessageThreadId).toBeNull();
  });

  it("throws when the clinician_alerts insert itself fails -- this write must not fail silently", async () => {
    const patientSupabase = { rpc: jest.fn() } as unknown as SupabaseClient<Database>;
    const from = jest.fn(() => ({
      insert: jest.fn(() => chainable({ data: null, error: { message: "constraint violation" } })),
    }));
    const serviceRole = { from } as unknown as SupabaseClient<Database>;

    await expect(requestSpecialistReferral(patientSupabase, serviceRole, PARAMS)).rejects.toThrow();
  });
});
