import { describe, expect, it } from "@jest/globals";
import { redGuidanceStatus } from "./red-guidance-copy";

describe("redGuidanceStatus (two-tier Free red path)", () => {
  it("says in plain words that no doctor was alerted on the Free plan, and offers Membership", () => {
    const s = redGuidanceStatus(false, true, true);
    expect(s.lines[0]).toBe("A doctor has not been alerted, because you are on the Free plan. Doctor review is part of Membership.");
    expect(s.showJoin).toBe(true);
    expect(s.lines.join(" ")).not.toMatch(/care team has been notified/i);
  });

  it("includes the recheck line, and the contact line only when a contact is saved", () => {
    expect(redGuidanceStatus(false, false, true).lines).toHaveLength(3);
    expect(redGuidanceStatus(false, false, false).lines).toHaveLength(2);
  });

  it("a Member is told the care team was notified (online) or will be (offline), with no join prompt", () => {
    expect(redGuidanceStatus(true, true, false).lines[0]).toMatch(/has been notified/);
    expect(redGuidanceStatus(true, false, false).lines[0]).toMatch(/as soon as you're back online/);
    expect(redGuidanceStatus(true, true, false).showJoin).toBe(false);
  });

  it("when membership cannot be worked out it makes no claim about a doctor either way", () => {
    const s = redGuidanceStatus(null, false, true);
    expect(s.lines.join(" ")).not.toMatch(/doctor|care team/i);
    expect(s.showJoin).toBe(false);
  });

  it("uses no em dashes and no fear wording", () => {
    for (const v of [true, false, null]) {
      const text = redGuidanceStatus(v, true, true).lines.join(" ");
      expect(text).not.toContain("—");
      expect(text).not.toMatch(/warning|danger|die|dead/i);
    }
  });
});
