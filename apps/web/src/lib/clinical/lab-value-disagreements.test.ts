import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { disagreementLine, parseLabValueDisagreements, readLabValueDisagreements } from "./lab-value-disagreements";

const row = {
  code: "ldl",
  reason: "value_differs",
  structured: { value: 3.1, unit: "mmol/L", at: "2026-10-10T10:00:00Z" },
  paper_report: { value: "4.4000", unit: "mmol/L", at: "2026-10-10T00:00:00Z" },
};

function client(result: { data: unknown; error: { message: string } | null }) {
  const rpc = jest.fn(async (..._a: unknown[]) => result);
  return { c: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("lab value disagreements (DUP-1)", () => {
  it("returns both values side by side and picks neither", () => {
    const r = parseLabValueDisagreements({ disagreements: [row] });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.rows[0]?.structured.value).toBe(3.1);
    expect(r.rows[0]?.paperReport.value).toBe(4.4);
    expect(disagreementLine(r.rows[0]!)).toBe("ldl: 3.1 mmol/L (laboratory result) and 4.4 mmol/L (filed report)");
  });

  it("a refusal is denied, never an empty list", () => {
    expect(parseLabValueDisagreements({ denied: true })).toEqual({ status: "denied" });
  });

  it("a malformed row or response is an error, not a silently shorter list", () => {
    expect(parseLabValueDisagreements({ disagreements: [{ ...row, paper_report: null }] }).status).toBe("error");
    expect(parseLabValueDisagreements(null).status).toBe("error");
    expect(parseLabValueDisagreements({}).status).toBe("error");
  });

  it("an empty list is ok and a different unit is called out", () => {
    expect(parseLabValueDisagreements({ disagreements: [] })).toEqual({ status: "ok", rows: [] });
    const r = parseLabValueDisagreements({ disagreements: [{ ...row, reason: "unit_differs" }] });
    if (r.status === "ok") expect(disagreementLine(r.rows[0]!)).toContain("different units");
  });

  it("asks the audited function with a reason of at least ten characters", async () => {
    const { c, rpc } = client({ data: { disagreements: [] }, error: null });
    await readLabValueDisagreements(c, "p1");
    const args = rpc.mock.calls[0] as [string, { p_patient: string; p_reason: string }];
    expect(args[0]).toBe("lab_value_disagreements");
    expect(args[1].p_patient).toBe("p1");
    expect(args[1].p_reason.length).toBeGreaterThanOrEqual(10);
  });

  it("an rpc error is an error", async () => {
    expect((await readLabValueDisagreements(client({ data: null, error: { message: "boom" } }).c, "p1")).status).toBe("error");
  });
});
