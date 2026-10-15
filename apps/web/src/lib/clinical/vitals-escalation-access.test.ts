import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { patientHasVitalsEscalationAccess } from "./vitals-escalation-access";

function client(result: { data: unknown; error: unknown }): SupabaseClient<Database> {
  return { rpc: jest.fn(async () => result) } as unknown as SupabaseClient<Database>;
}

describe("patientHasVitalsEscalationAccess (two-tier, CMO 2026-10-08)", () => {
  it("pages for a Member and withholds for a Free patient", async () => {
    expect(await patientHasVitalsEscalationAccess(client({ data: true, error: null }), "p")).toBe(true);
    expect(await patientHasVitalsEscalationAccess(client({ data: false, error: null }), "p")).toBe(false);
  });

  it("fails closed toward paging when membership cannot be worked out", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await patientHasVitalsEscalationAccess(client({ data: null, error: { message: "boom" } }), "p")).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
