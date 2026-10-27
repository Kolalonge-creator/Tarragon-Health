import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@tarragon/i18n";
import {
  BRIEF_FEEDBACK_LABEL,
  BRIEF_FEEDBACK_VALUES,
  OVERRIDE_REASON_CODES,
  OVERRIDE_REASON_LABEL,
  briefFeedbackSchema,
  overrideReasonCodeSchema,
} from "./override-reasons";

describe("override reason codes", () => {
  it("matches the database enum exactly", () => {
    const sql = readFileSync(
      join(__dirname, "../../../../../supabase/migrations/20261027194255_w02_override_reason_codes_and_brief_feedback.sql"),
      "utf8",
    );
    const m = /create type public\.override_reason_code as enum \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const values = m![1]!.split(",").map((v) => v.trim().replace(/'/g, ""));
    expect(values).toEqual([...OVERRIDE_REASON_CODES]);
  });

  it("has a label for every code and none for anything else", () => {
    expect(Object.keys(OVERRIDE_REASON_LABEL).sort()).toEqual([...OVERRIDE_REASON_CODES].sort());
    expect(overrideReasonCodeSchema.safeParse("made_up").success).toBe(false);
  });

  it("covers the three brief feedback values", () => {
    expect([...BRIEF_FEEDBACK_VALUES]).toEqual(["useful", "unsafe", "missing"]);
    expect(Object.keys(BRIEF_FEEDBACK_LABEL).sort()).toEqual(["missing", "unsafe", "useful"]);
    expect(briefFeedbackSchema.safeParse("great").success).toBe(false);
  });

  it("uses the agreed override copy and no dashes", () => {
    expect(en["override.why"]).toBe("Why are you changing this?");
    expect(en["override.helper"]).toBe("Your reason helps us check our own rules. It is never used to rate you.");
    const all = [...Object.values(OVERRIDE_REASON_LABEL), ...Object.values(BRIEF_FEEDBACK_LABEL), en["override.why"], en["override.choose"], en["override.helper"]];
    for (const text of all) expect(text).not.toMatch(/[–—]/);
  });

  it("is not read by any ranking, queue or triage code", () => {
    const root = join(__dirname, "..");
    for (const f of ["triage/score.ts", "worklist/message-triage.ts"]) {
      let src = "";
      try {
        src = readFileSync(join(root, f), "utf8");
      } catch {
        continue;
      }
      expect(src).not.toMatch(/override_reason_code|overrideReasonCode/);
    }
  });
});
