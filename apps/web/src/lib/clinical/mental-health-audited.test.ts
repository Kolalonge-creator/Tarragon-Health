import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { parseMentalHealthPayload, readPatientMentalHealthAudited, readPatientMentalHealthOrThrow } from "./mental-health-audited";

function clientReturning(data: unknown, error: { message: string } | null = null) {
  const rpc = jest.fn(async (_fn: string, _args: unknown) => ({ data, error }));
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("parseMentalHealthPayload (INV-10)", () => {
  it("returns the sections, and an empty ok list is an empty list", () => {
    expect(parseMentalHealthPayload({ status: "ok", screens: [] })).toEqual({ status: "ok", data: { screens: [] } });
  });
  it("a refusal is denied, never an empty list", () => {
    expect(parseMentalHealthPayload({ status: "denied" })).toEqual({ status: "denied" });
  });
  it("a malformed or missing response is an error, never an empty list", () => {
    for (const bad of [null, undefined, "x", {}, { status: "weird" }, { status: "ok", screens: "no" }]) {
      expect(parseMentalHealthPayload(bad).status).toBe("error");
    }
  });
});

describe("readPatientMentalHealthAudited", () => {
  it("asks for the screens by default with the routine reason", async () => {
    const { client, rpc } = clientReturning({ status: "ok", screens: [] });
    await readPatientMentalHealthAudited(client, "p1");
    expect(rpc).toHaveBeenCalledWith("read_patient_mental_health_audited", { p_patient: "p1", p_reason: expect.any(String), p_sections: ["screens"] });
  });
  it("an rpc error is an error result, and the throwing variant throws for error and denied alike", async () => {
    expect((await readPatientMentalHealthAudited(clientReturning(null, { message: "boom" }).client, "p1")).status).toBe("error");
    await expect(readPatientMentalHealthOrThrow(clientReturning({ status: "denied" }).client, "p1")).rejects.toThrow(/not available to you/);
    await expect(readPatientMentalHealthOrThrow(clientReturning(null, { message: "boom" }).client, "p1")).rejects.toThrow("boom");
    await expect(readPatientMentalHealthOrThrow(clientReturning({ status: "ok", screens: [{ id: "s" }] }).client, "p1")).resolves.toEqual({ screens: [{ id: "s" }] });
  });
});
