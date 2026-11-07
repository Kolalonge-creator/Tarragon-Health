import { describe as suite, expect, it } from "@jest/globals";
import { describe } from "./describe-in-app";

const id = "6f1c2b3a-1111-4222-8333-944455556666";
const note = (template: string, payload: Record<string, unknown>) =>
  ({ id: "n1", template, payload, created_at: "2026-11-07T08:00:00Z", read_at: null }) as Parameters<typeof describe>[0];

suite("escalation handover notices (G10)", () => {
  it.each([
    ["escalation_handover_offered", "A doctor wants to hand a case to you"],
    ["escalation_handover_accepted", "Your handover was accepted; the case has moved"],
    ["escalation_handover_declined", "Your handover was declined; the case is still yours"],
    ["escalation_handover_cancelled", "A handover was cancelled; the case has not moved"],
    ["escalation_handover_superseded", "A case offered to you no longer needs your answer"],
  ])("%s has fixed wording with no patient or clinical detail and opens the case", (template, text) => {
    const out = describe(note(template, { escalation_id: id, handover_id: "x" }));
    expect(out.text).toBe(text);
    expect(out.href).toBe(`/clinician/escalations/${id}`);
  });

  it("falls back to the worklist when the id is missing or not a uuid", () => {
    expect(describe(note("escalation_handover_offered", {})).href).toBe("/clinician/worklist");
    expect(describe(note("escalation_handover_declined", { escalation_id: "../admin" })).href).toBe("/clinician/worklist");
  });
});
