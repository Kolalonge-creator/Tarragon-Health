import { describe, expect, it } from "@jest/globals";
import { availableLifecycleKinds, babyContentHidden, lifecycleRules, nextStage, LIFECYCLE_KINDS, LIFECYCLE_STAGES } from "./lifecycle";

describe("lifecycle state machine (confirmed events only)", () => {
  it("every kind in the configuration is a known kind and every target a known stage", () => {
    const { rules } = lifecycleRules();
    expect(Object.keys(rules.transitions).sort()).toEqual([...LIFECYCLE_KINDS].sort());
    for (const t of Object.values(rules.transitions)) {
      expect(LIFECYCLE_STAGES).toContain(t.to);
      for (const f of t.from) expect(LIFECYCLE_STAGES).toContain(f);
    }
  });

  it("walks tracking -> pregnant -> postnatal -> parenting only through confirmed events", () => {
    expect(nextStage("tracking", "pregnancy_confirmed")).toBe("pregnant");
    expect(nextStage("pregnant", "delivery_recorded")).toBe("postnatal");
    expect(nextStage("postnatal", "postnatal_period_ended")).toBe("parenting");
    expect(nextStage("parenting", "parenting_ended")).toBe("tracking");
  });

  it("a loss returns to tracking, and can only be recorded from pregnant", () => {
    expect(nextStage("pregnant", "pregnancy_loss_recorded")).toBe("tracking");
    for (const s of ["tracking", "trying", "postnatal", "parenting"] as const) expect(nextStage(s, "pregnancy_loss_recorded")).toBeNull();
  });

  it("there is no event that moves a stage by time or age: no kind mentions a date, a week or an age", () => {
    for (const k of LIFECYCLE_KINDS) expect(k).not.toMatch(/week|month|age|elapsed|auto|infer|due_date/);
  });

  it("offers only what is available from where the person is", () => {
    expect(availableLifecycleKinds("tracking")).toEqual(["start_trying", "pregnancy_confirmed", "delivery_recorded"]);
    expect(availableLifecycleKinds("pregnant")).toEqual(["delivery_recorded", "pregnancy_loss_recorded"]);
    expect(availableLifecycleKinds("postnatal")).toEqual(["pregnancy_confirmed", "postnatal_period_ended"]);
  });

  it("holds baby content back after a loss until the hold date passes", () => {
    expect(babyContentHidden(null, "2026-10-07")).toBe(false);
    expect(babyContentHidden("2027-01-05", "2026-10-07")).toBe(true);
    expect(babyContentHidden("2026-10-07", "2026-10-07")).toBe(true);
    expect(babyContentHidden("2026-10-06", "2026-10-07")).toBe(false);
  });
});
