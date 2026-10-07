/**
 * S51: the three assistant nudge templates have generic in-app text (INV-07: no condition, reading or medicine names) and a real link.
 */
import { describe, expect, it } from "@jest/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe as describeInApp } from "./describe-in-app";

describe("the three assistant nudge templates", () => {
  it.each(["assistant_daily_nudge", "assistant_weekly_reflection", "assistant_reengage"])("%s has its own generic line and a real link", (template) => {
    const out = describeInApp({ template, payload: { condition: "diabetes", medicine: "metformin", reading: "180/110" } });
    expect(out.text).not.toBe("You have an update");
    expect(out.text).not.toMatch(/diabet|metformin|180|blood|pressure|insulin|result/i);
    expect(existsSync(join(__dirname, "..", "..", "app", "(dashboard)", "patient", "(sections)", "care", "page.tsx"))).toBe(true);
    expect(out.href).toBe("/patient/care");
  });
});
