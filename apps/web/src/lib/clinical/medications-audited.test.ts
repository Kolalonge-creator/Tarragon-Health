import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { attachMedicationEmbeds, parseMedicationEmbeds, parseMedicationsPayload } from "./medications-audited";

describe("parseMedicationsPayload (INV-10)", () => {
  it("returns the rows, and an empty ok list is an empty list", () => {
    expect(parseMedicationsPayload({ status: "ok", rows: [{ id: "m1" }] })).toEqual({ status: "ok", rows: [{ id: "m1" }] });
    expect(parseMedicationsPayload({ status: "ok", rows: [] })).toEqual({ status: "ok", rows: [] });
  });

  it("a refusal is denied, never an empty list", () => {
    expect(parseMedicationsPayload({ status: "denied", rows: [] })).toEqual({ status: "denied" });
  });

  it("a malformed or missing response is an error, never an empty list", () => {
    for (const bad of [null, undefined, "x", {}, { status: "ok" }, { status: "weird", rows: [] }]) {
      expect(parseMedicationsPayload(bad).status).toBe("error");
    }
  });
});

describe("parseMedicationEmbeds", () => {
  it("accepts an object map and rejects anything else", () => {
    expect(parseMedicationEmbeds({})).toEqual({});
    for (const bad of [null, undefined, [], "x", 3]) expect(() => parseMedicationEmbeds(bad)).toThrow();
  });
});

function clientReturning(data: unknown, error: { message: string } | null = null) {
  const rpc = jest.fn(async (_fn: string, _args: unknown) => ({ data, error }));
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("attachMedicationEmbeds", () => {
  it("attaches the medication object, and null for a row whose medicine the caller may not see", async () => {
    const { client, rpc } = clientReturning({ m1: { patient_id: "p", drug_name: "Amlodipine", dose: "5mg", frequency: null, rx_number: null, repeats_allowed: 0 } });
    const rows = await attachMedicationEmbeds(client, [{ id: "r1", medication_id: "m1" }, { id: "r2", medication_id: "m2" }, { id: "r3", medication_id: null }]);
    expect(rows.map((r) => r.medication?.drug_name ?? null)).toEqual(["Amlodipine", null, null]);
    expect(rpc).toHaveBeenCalledWith("read_medication_embeds_audited", { p_ids: ["m1", "m2"] });
  });

  it("makes no call when no row has a medication", async () => {
    const { client, rpc } = clientReturning({});
    expect(await attachMedicationEmbeds(client, [{ medication_id: null }])).toEqual([{ medication_id: null, medication: null }]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws on an error or a malformed response, so a failed read never looks like no medicines", async () => {
    await expect(attachMedicationEmbeds(clientReturning(null, { message: "boom" }).client, [{ medication_id: "m1" }])).rejects.toBeTruthy();
    await expect(attachMedicationEmbeds(clientReturning([]).client, [{ medication_id: "m1" }])).rejects.toThrow();
  });
});
