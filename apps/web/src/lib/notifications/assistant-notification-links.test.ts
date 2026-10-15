/**
 * S52: the assistant's self-harm page must link to a page that really shows the case (never an empty /clinician/on-call), and the three
 * assistant nudge templates have generic in-app text (INV-07: no condition, reading or medicine names).
 */
import { describe, expect, it } from "@jest/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe as describeInApp } from "./describe-in-app";

const appDir = join(__dirname, "..", "..", "app", "(dashboard)");
const routeExists = (href: string): boolean => existsSync(join(appDir, ...href.split("/").filter(Boolean), "page.tsx")) || existsSync(join(appDir, "patient", "(sections)", ...href.split("/").filter(Boolean).slice(1), "page.tsx"));

describe("the assistant's on-call notice", () => {
  const crisis = describeInApp({ template: "on_call_page", payload: { kind: "assistant_crisis" } });

  it("links to the clinician queue, which is a real page that lists the class 1 case", () => {
    expect(crisis.href).toBe("/clinician/queue");
    expect(routeExists(crisis.href)).toBe(true);
  });

  it("names nobody and nothing clinical", () => {
    expect(crisis.text).toBe("A priority case is waiting for you");
  });

  it("an S19 red page still links to the on-call page, which shows its page row", () => {
    const s19 = describeInApp({ template: "on_call_page", payload: {} });
    expect(s19.href).toBe("/clinician/on-call");
    expect(routeExists(s19.href)).toBe(true);
  });
});

describe("the three assistant nudge templates", () => {
  it.each(["assistant_daily_nudge", "assistant_weekly_reflection", "assistant_reengage"])("%s has its own generic line and a real link", (template) => {
    const out = describeInApp({ template, payload: { condition: "diabetes", medicine: "metformin", reading: "180/110" } });
    expect(out.text).not.toBe("You have an update");
    expect(out.text).not.toMatch(/diabet|metformin|180|blood|pressure|insulin|result/i);
    expect(routeExists(out.href)).toBe(true);
  });
});
