import { isPortionGuideBody, parsePortionGuide, portionAudienceFor, portionFor, getProposedConfig, selectRecordLesson, type PortionGuideConfig, type RecordLessonConfig } from "@tarragon/shared";
import { portionPhrase } from "@tarragon/i18n";

jest.mock("./supabase", () => ({ supabase: {} }));

import { glucoseLevel } from "./learning-quality";

describe("glucoseLevel (phone, single reading)", () => {
  it("maps the bundled classifier's tiers onto the shared levels", () => {
    expect(glucoseLevel(null)).toBe("unknown");
    expect(glucoseLevel(2.5)).toBe("emergency"); // severe hypo
    expect(glucoseLevel(5.5)).toBe("green");
  });
  it("never invents a band between the classifier's own: the tier decides", () => {
    for (const mmol of [3.2, 3.8, 4.4, 7, 11, 16, 22]) {
      expect(["green", "amber", "red", "emergency"]).toContain(glucoseLevel(mmol));
    }
  });
});

describe("portion guide on the phone works from a downloaded lesson body and the bundled configuration (no network)", () => {
  const body = "Use your hand.\n\n[portion swallow fist] Pounded yam, eba\nEat it with soup.\n\n[portion seasoning_cube fingertip] Seasoning cubes\nUse few.\n\nA note.";
  const cfg = getProposedConfig("learning.portion_guide").value as unknown as PortionGuideConfig;
  it("recognises the body, parses the foods and finds each amount in the bundled config", () => {
    expect(isPortionGuideBody(body)).toBe(true);
    const foods = parsePortionGuide(body).foods;
    expect(foods.map((f) => f.ref)).toEqual(["swallow", "seasoning_cube"]);
    expect(portionPhrase(portionFor(cfg, "swallow", portionAudienceFor("diabetes", null)) as never)).toBe("About 1 fist each meal");
    expect(portionPhrase(portionFor(cfg, "seasoning_cube", portionAudienceFor("hypertension", null)) as never)).toBe("About 1 seasoning cube for each pot");
  });
  it("picks the audience from the item's own category or condition", () => {
    expect(portionAudienceFor("diabetes", null)).toBe("diabetes");
    expect(portionAudienceFor("nutrition", "diabetes")).toBe("diabetes");
    expect(portionAudienceFor("hypertension", "hypertension")).toBe("blood_pressure");
    expect(portionAudienceFor(null, null)).toBe("blood_pressure");
  });
});

describe("record lesson selection is shared with the web (urgent outranks a lesson)", () => {
  const cfg = getProposedConfig("learning.record_lessons").value as unknown as RecordLessonConfig;
  it("a red reading yields urgent, never a lesson, even beside a green glucose reading", () => {
    const now = "2026-10-22T10:00:00.000Z";
    const d = selectRecordLesson(
      { now, bloodPressure: [{ id: "bp", takenAt: now, level: "red" }], glucose: [{ id: "g", takenAt: now, level: "green" }], labItems: [] },
      cfg,
    );
    expect(d.kind).toBe("urgent");
  });
});
