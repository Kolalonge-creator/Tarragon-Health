import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * A guard on the first screens a new user sees.
 *
 * These are the two surfaces most likely to outlive a business-model change,
 * and they had: "book the lab" and "pick a partner lab near you" (Tarragon
 * does not book or bill labs on a patient's behalf, and the marketing page
 * that feeds this very screen already said "any laboratory you like"), "on any
 * plan including the free one" and "part of the paid plans" (subscription
 * plans were retired outright), "at no extra cost" (implying a price ladder
 * that no longer exists), and a forward button reading "Continue to choose
 * your plan" that went to the confirmation screen because no plan step exists.
 *
 * This reads the source rather than importing it, for a specific reason: the
 * copy lives in module-local constants inside a Next.js `page.tsx`, and an app
 * router page module may only export a fixed set of names, so there is nothing
 * to import. Comments are stripped first, so the explanatory notes recording
 * what these phrases USED to say (including in this file's own subject
 * modules) do not trip the assertions.
 */
function copyOf(...segments: string[]): string {
  const source = readFileSync(join(__dirname, ...segments), "utf8");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments, JSDoc included
    .replace(/^\s*\/\/.*$/gm, " "); // whole-line comments
}

const SIGNUP_PAGE = copyOf("page.tsx");
const ONBOARDING_FLOW = copyOf("..", "onboarding", "onboarding-flow.tsx");
const INTAKE_STEP = copyOf("..", "onboarding", "intake-step.tsx");

describe("signup page copy", () => {
  it("does not promise that Tarragon books or picks a lab", () => {
    expect(SIGNUP_PAGE).not.toMatch(/book the lab/i);
    expect(SIGNUP_PAGE).not.toMatch(/partner lab/i);
    expect(SIGNUP_PAGE).not.toMatch(/pick your lab/i);
  });

  it("does not sell a subscription plan", () => {
    expect(SIGNUP_PAGE).not.toMatch(/any plan/i);
    expect(SIGNUP_PAGE).not.toMatch(/no extra cost/i);
    expect(SIGNUP_PAGE).not.toMatch(/free to start/i);
  });

  it("uses no em dashes, per the standing copy rule", () => {
    expect(SIGNUP_PAGE).not.toContain("—");
  });
});

describe("onboarding copy", () => {
  it("does not describe routine review as a paid plan feature", () => {
    // The same flow's own confirmation screen says the app is free and only a
    // doctor's time is paid for. Both statements cannot be true.
    expect(ONBOARDING_FLOW).not.toMatch(/paid plans/i);
    expect(ONBOARDING_FLOW).not.toMatch(/on every plan/i);
  });

  it("does not point a forward control at a plan step that does not exist", () => {
    expect(INTAKE_STEP).not.toMatch(/choose your plan/i);
  });

  it("uses no em dashes in either step, per the standing copy rule", () => {
    expect(ONBOARDING_FLOW).not.toContain("—");
    expect(INTAKE_STEP).not.toContain("—");
  });
});
