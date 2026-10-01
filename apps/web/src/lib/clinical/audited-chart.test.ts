import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { readAuditedSection, ROUTINE_CHART_READ_REASON } from "./audited-chart";

function clientReturning(result: { data: unknown; error: { message: string } | null }) {
  const rpc = jest.fn(async (..._args: unknown[]) => result);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("readAuditedSection (INV-10)", () => {
  it("asks for exactly one section with the routine reason and returns its rows", async () => {
    const { client, rpc } = clientReturning({
      data: { status: "ok", sections: { allergies: [{ id: "a1", substance: "penicillin" }] }, denied: [] },
      error: null,
    });
    const result = await readAuditedSection(client, "p1", "allergies");
    expect(rpc).toHaveBeenCalledWith("read_patient_chart_audited", {
      p_patient: "p1",
      p_sections: ["allergies"],
      p_reason: ROUTINE_CHART_READ_REASON,
    });
    expect(result).toEqual({ status: "ok", rows: [{ id: "a1", substance: "penicillin" }] });
    expect(ROUTINE_CHART_READ_REASON.length).toBeGreaterThanOrEqual(10);
  });

  it("an empty list is ok, and is not the same as denied", async () => {
    const { client } = clientReturning({ data: { status: "ok", sections: { conditions: [] }, denied: [] }, error: null });
    expect(await readAuditedSection(client, "p1", "conditions")).toEqual({ status: "ok", rows: [] });
  });

  it("a refused read is denied, never an empty list", async () => {
    const { client } = clientReturning({ data: { status: "denied", sections: {}, denied: ["allergies"] }, error: null });
    expect(await readAuditedSection(client, "p1", "allergies")).toEqual({ status: "denied" });
  });

  it("a partial response that lacks the asked section is denied", async () => {
    const { client } = clientReturning({ data: { status: "partial", sections: {}, denied: ["allergies"] }, error: null });
    expect(await readAuditedSection(client, "p1", "allergies")).toEqual({ status: "denied" });
  });

  it("an rpc error and a malformed response are errors, not empty data", async () => {
    expect((await readAuditedSection(clientReturning({ data: null, error: { message: "boom" } }).client, "p1", "allergies")).status).toBe("error");
    expect((await readAuditedSection(clientReturning({ data: null, error: null }).client, "p1", "allergies")).status).toBe("error");
    expect((await readAuditedSection(clientReturning({ data: { status: "ok", sections: {} }, error: null }).client, "p1", "allergies")).status).toBe("error");
  });
});
