import { consentStateSchema, consentView } from "./consent-state";

describe("consentView", () => {
  it("blocks with a reason for every state but given-and-startable", () => {
    expect(consentView({ state: "no_consultation" })).toEqual({ kind: "blocked", messageKey: "scribe.gate.no_consultation" });
    expect(consentView({ state: "not_asked", may_start: false })).toEqual({ kind: "blocked", messageKey: "scribe.gate.not_asked" });
    expect(consentView({ state: "declined" })).toEqual({ kind: "blocked", messageKey: "scribe.gate.declined" });
  });
  it("given but not startable (not live, or the guard is off) is blocked, never started", () => {
    expect(consentView({ state: "given", may_start: false })).toEqual({ kind: "blocked", messageKey: "scribe.gate.not_available_now" });
    expect(consentView({ state: "given" })).toEqual({ kind: "blocked", messageKey: "scribe.gate.not_available_now" });
  });
  it("starts only when the patient said yes and the database says it may start", () => {
    expect(consentView({ state: "given", may_start: true })).toEqual({ kind: "can_start" });
  });
  it("an unknown state does not parse, so it cannot read as consent", () => {
    expect(consentStateSchema.safeParse({ state: "yes" }).success).toBe(false);
  });
});
