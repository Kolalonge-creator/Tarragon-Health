import { describe, expect, it } from "@jest/globals";
import { t, en } from "@tarragon/i18n";
import { NEXT_ACTION_COPY, NEXT_ACTION_ORDER, pickNextAction, type NextActionFacts, type NextActionKind } from "./next-action-priority";

const NONE: NextActionFacts = {
  hasUnansweredRedAlert: false,
  hasDoseDue: false,
  readingDue: false,
  refillDrugName: null,
  screeningName: null,
  hasConsultSlotsOffered: false,
  hasCheckinOpen: false,
  hasReviewDue: false,
  lessonReady: false,
};

/** Every fact true: the top of the order must win, and removing it must reveal the next one, all the way down. */
const ALL: NextActionFacts = {
  hasUnansweredRedAlert: true,
  hasDoseDue: true,
  readingDue: true,
  refillDrugName: "Drug",
  screeningName: "Screen",
  hasConsultSlotsOffered: true,
  hasCheckinOpen: true,
  hasReviewDue: true,
  lessonReady: true,
};

describe("pickNextAction (design principle 1: Home shows one next action)", () => {
  it("is caught up when nothing is waiting", () => {
    expect(pickNextAction(NONE).kind).toBe("caught_up");
  });

  it("follows the founder's order: red alert, due dose, due reading, refill, then lesson last", () => {
    const f: NextActionFacts = { ...ALL };
    const seen: NextActionKind[] = [];
    seen.push(pickNextAction(f).kind);
    f.hasUnansweredRedAlert = false;
    seen.push(pickNextAction(f).kind);
    f.hasDoseDue = false;
    seen.push(pickNextAction(f).kind);
    f.readingDue = false;
    seen.push(pickNextAction(f).kind);
    f.refillDrugName = null;
    f.screeningName = null;
    f.hasConsultSlotsOffered = false;
    f.hasCheckinOpen = false;
    f.hasReviewDue = false;
    seen.push(pickNextAction(f).kind);
    f.lessonReady = false;
    seen.push(pickNextAction(f).kind);
    expect(seen).toEqual(["red_alert", "dose_due", "reading_due", "refill_low", "lesson_ready", "caught_up"]);
  });

  it("an unanswered red alert beats everything else, whatever else is true", () => {
    expect(pickNextAction({ ...ALL }).kind).toBe("red_alert");
    expect(pickNextAction({ ...NONE, hasUnansweredRedAlert: true, lessonReady: true }).kind).toBe("red_alert");
  });

  it("passes the drug or screening name through as a param", () => {
    expect(pickNextAction({ ...NONE, refillDrugName: "Amlodipine" }).params).toEqual({ name: "Amlodipine" });
    expect(pickNextAction({ ...NONE, screeningName: "cervical screening" }).params).toEqual({ name: "cervical screening" });
  });

  it("the documented order lists every kind exactly once, and every kind has title, body and cta copy with no em dash", () => {
    expect(new Set(NEXT_ACTION_ORDER).size).toBe(NEXT_ACTION_ORDER.length);
    for (const kind of NEXT_ACTION_ORDER) {
      for (const part of ["title", "body", "cta"] as const) {
        const key = NEXT_ACTION_COPY[kind][part];
        expect(en[key]).toBeDefined();
        expect(t(key, "en", { name: "x" })).not.toMatch(/—/);
      }
    }
  });

  it("the red alert card says nothing clinical (it sits under the emergency guidance, never above it)", () => {
    const text = [t("dp.next.red_alert.title"), t("dp.next.red_alert.body")].join(" ").toLowerCase();
    for (const word of ["pressure", "sugar", "glucose", "heart", "reading", "result", "doctor has", "care team has"]) {
      expect(text).not.toContain(word);
    }
  });
});

describe("failed reads never read as all clear", () => {
  it("falls back to the reading prompt, not caught_up, when a query failed", () => {
    expect(pickNextAction({ ...NONE, dataUnavailable: true }).kind).toBe("reading_due");
  });
  it("still lets a red alert win over a failed read", () => {
    expect(pickNextAction({ ...NONE, hasUnansweredRedAlert: true, dataUnavailable: true }).kind).toBe("red_alert");
  });
});

describe("unknown red-alert state and the dose card", () => {
  it("an unknown red-alert read ranks below a confirmed alert and above every other step", () => {
    expect(pickNextAction({ ...ALL, redAlertUnknown: true }).kind).toBe("red_alert");
    expect(pickNextAction({ ...ALL, hasUnansweredRedAlert: false, redAlertUnknown: true }).kind).toBe("safety_check");
  });
  it("the safety-check and dose cards make no clinician claim, name no medicine, and use no em dash", () => {
    for (const k of ["safety_check", "dose_due"] as const) {
      const text = (["title", "body", "cta"] as const).map((p) => t(NEXT_ACTION_COPY[k][p])).join(" ");
      expect(text).not.toMatch(/—|your doctor|care team has|has been (told|notified)/i);
    }
    expect(t("dp.next.dose.title")).toBe("A dose is due");
  });
});
