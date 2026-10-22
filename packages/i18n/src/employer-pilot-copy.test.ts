import { describe, expect, it } from "@jest/globals";
import { employerPilotCopy, employerPilotText } from "./employer-pilot-copy";

const entries = Object.entries(employerPilotCopy);

describe("employer seat pilot copy", () => {
  it("has no em dash and no en dash", () => {
    for (const [k, v] of entries) expect(`${k}: ${v}`).not.toMatch(/[–—]/);
  });

  it("never says 'your doctor' and never makes an outcome, saving or return claim", () => {
    for (const [, v] of entries) {
      expect(v.toLowerCase()).not.toContain("your doctor");
      expect(v.toLowerCase()).not.toMatch(/\b(saving|savings|roi|return on|reduce cost|lower cost|cut cost|outcome)\b/);
      expect(v.toLowerCase()).not.toContain("doctor-led");
    }
  });

  it("states that the employer sees counts only and that small groups are withheld (I9)", () => {
    expect(employerPilotCopy["pilot.privacy"]).toMatch(/counts only/i);
    expect(employerPilotCopy["pilot.privacy"]).toMatch(/withheld/i);
  });

  it("fills its placeholders", () => {
    const t = employerPilotText("pilot.usage.note", { rounded: 5, through: "2026-10-11", min: 10 });
    expect(t).toContain("nearest 5");
    expect(t).toContain("2026-10-11");
    expect(t).toContain("fewer than 10 people");
    expect(t).not.toMatch(/[{}]/);
  });
});
