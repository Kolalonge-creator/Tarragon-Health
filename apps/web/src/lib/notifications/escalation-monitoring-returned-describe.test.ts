import { describe as suite, expect, it } from "@jest/globals";
import { describe } from "./describe-in-app";

const base = { id: "n1", template: "escalation_monitoring_returned", created_at: "2026-11-07T08:00:00Z", read_at: null };

suite("escalation_monitoring_returned (DW-11 follow-up)", () => {
  it("says the case is back, with no patient or clinical detail, and opens the case", () => {
    const out = describe({ ...base, payload: { escalation_id: "6f1c2b3a-1111-4222-8333-944455556666" } } as Parameters<typeof describe>[0]);
    expect(out.text).toBe("A case you were monitoring is back for review");
    expect(out.href).toBe("/clinician/escalations/6f1c2b3a-1111-4222-8333-944455556666");
  });

  it("falls back to the worklist when the id is missing or not a uuid", () => {
    expect(describe({ ...base, payload: {} } as Parameters<typeof describe>[0]).href).toBe("/clinician/worklist");
    expect(describe({ ...base, payload: { escalation_id: "../admin" } } as Parameters<typeof describe>[0]).href).toBe("/clinician/worklist");
  });
});
