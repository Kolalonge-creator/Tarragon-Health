import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { parseVitalsPayload, readPatientVitalsAudited, readPatientVitalsOrThrow } from "./vitals-audited";

describe("parseVitalsPayload (INV-10)", () => {
  it("returns the rows, and an empty ok list is an empty list", () => {
    expect(parseVitalsPayload({ status: "ok", rows: [{ id: "v1" }] })).toEqual({ status: "ok", rows: [{ id: "v1" }] });
    expect(parseVitalsPayload({ status: "ok", rows: [] })).toEqual({ status: "ok", rows: [] });
  });

  it("a refusal is denied, never an empty list", () => {
    expect(parseVitalsPayload({ status: "denied", rows: [] })).toEqual({ status: "denied" });
  });

  it("a malformed or missing response is an error, never an empty list", () => {
    for (const bad of [null, undefined, "x", {}, { status: "ok" }, { status: "weird", rows: [] }]) {
      expect(parseVitalsPayload(bad).status).toBe("error");
    }
  });
});

function clientReturning(data: unknown, error: { message: string } | null = null) {
  const rpc = jest.fn(async (_fn: string, _args: unknown) => ({ data, error }));
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("readPatientVitalsAudited", () => {
  it("passes only the options that were set, plus the routine reason", async () => {
    const { client, rpc } = clientReturning({ status: "ok", rows: [] });
    await readPatientVitalsAudited(client, "p1", { vitalType: "weight", limit: 1 });
    expect(rpc).toHaveBeenCalledWith("read_patient_vitals_audited", {
      p_patient: "p1",
      p_reason: expect.any(String),
      p_vital_type: "weight",
      p_limit: 1,
    });
  });

  it("an rpc error is an error result, and the throwing variant throws for error and denied alike", async () => {
    expect((await readPatientVitalsAudited(clientReturning(null, { message: "boom" }).client, "p1")).status).toBe("error");
    await expect(readPatientVitalsOrThrow(clientReturning(null, { message: "boom" }).client, "p1")).rejects.toThrow("boom");
    await expect(readPatientVitalsOrThrow(clientReturning({ status: "denied", rows: [] }).client, "p1")).rejects.toThrow("not available");
    await expect(readPatientVitalsOrThrow(clientReturning({ status: "ok", rows: [{ id: "v1" }] }).client, "p1")).resolves.toEqual([{ id: "v1" }]);
  });
});
