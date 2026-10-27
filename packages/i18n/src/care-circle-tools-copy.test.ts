import { describe, expect, it } from "@jest/globals";
import { CIRCLE_TOOLS_COPY_REVIEW, circleToolsCanKey, circleToolsCopy, circleToolsSeesKey, circleToolsTaskKindKey } from "./care-circle-tools-copy";
import { en } from "./en";

const keys = Object.keys(circleToolsCopy) as (keyof typeof circleToolsCopy)[];

describe("Care Circle tools copy (S69b)", () => {
  it("is part of the English catalogue and every key is under the review prefix", () => {
    for (const k of keys) {
      expect(en[k]).toBe(circleToolsCopy[k]);
      expect(CIRCLE_TOOLS_COPY_REVIEW.prefixes.some((p) => k.startsWith(p))).toBe(true);
    }
  });

  it("is marked pending review and nothing in code says otherwise", () => {
    expect(CIRCLE_TOOLS_COPY_REVIEW.status).toBe("pending_cmo_review");
    expect(CIRCLE_TOOLS_COPY_REVIEW.owner).toBe("CMO");
  });

  it("has no em dashes and never says 'your doctor'", () => {
    for (const k of keys) {
      expect(circleToolsCopy[k]).not.toContain("—");
      expect(circleToolsCopy[k].toLowerCase()).not.toContain("your doctor");
    }
  });

  it("never says declined, rejected or refused to a person whose invite was turned down", () => {
    for (const k of keys.filter((x) => x.startsWith("cctools.invite."))) {
      expect(circleToolsCopy[k]).not.toMatch(/declin|reject|refus|turned (it )?down|said no/i);
    }
  });

  it("names no condition and no medicine, and the nudge text says nothing about what was missed", () => {
    for (const k of keys) {
      expect(circleToolsCopy[k]).not.toMatch(/hypertens|diabet|asthma|cancer|hiv|sickle|stroke|heart|kidney|pregnan|insulin|metformin/i);
    }
    for (const k of keys.filter((x) => x.startsWith("cctools.nudges."))) {
      expect(circleToolsCopy[k]).not.toMatch(/dose|medicine|pill|missed|forgot|late/i);
    }
  });

  it("every preview code has a catalogue key", () => {
    for (const c of ["adherence", "bp", "appointments", "digest"] as const) expect(en[circleToolsSeesKey(c)]).toBeTruthy();
    for (const c of ["alert", "pay", "tasks", "call"] as const) expect(en[circleToolsCanKey(c)]).toBeTruthy();
    for (const k of ["take_to_appointment", "take_to_lab", "collect_medicines", "visit", "phone_call", "errand"]) {
      expect(circleToolsTaskKindKey(k)).toBe(`cctools.task.kind.${k}`);
    }
    expect(circleToolsTaskKindKey("something_newer")).toBe("cctools.task.kind.errand");
  });
});
