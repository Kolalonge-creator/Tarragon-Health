import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONDITION_CODES,
  GOAL_CODES,
  answersFromRows,
  focusFromAnswers,
  planStepsFromAnswers,
  validateOnboardingAnswers,
  type OnboardingAnswers,
} from "./onboarding-answers";

const MIGRATION = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20261007230154_s41_onboarding_answers_and_lga.sql",
);

function sqlCodes(question: string): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const m = new RegExp(`when '${question}' then p_option in \\(([^)]*)\\)`).exec(sql);
  if (!m?.[1]) throw new Error(`no option list for ${question}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1] as string);
}

describe("option codes mirror the migration", () => {
  it("goals", () => expect([...GOAL_CODES].sort()).toEqual(sqlCodes("goals").sort()));
  it("conditions", () => expect([...CONDITION_CODES].sort()).toEqual(sqlCodes("conditions").sort()));
});

describe("validateOnboardingAnswers (same rules as the RPC)", () => {
  it("accepts a normal answer and drops duplicates", () => {
    const v = validateOnboardingAnswers(["stay_ahead", "stay_ahead"], ["none"]);
    expect(v).toEqual({ ok: true, value: { goals: ["stay_ahead"], conditions: ["none"] } });
  });
  it("refuses unknown, empty and oversize lists", () => {
    expect(validateOnboardingAnswers(["x"], ["none"]).ok).toBe(false);
    expect(validateOnboardingAnswers([], ["none"]).ok).toBe(false);
    expect(validateOnboardingAnswers(["stay_ahead"], []).ok).toBe(false);
    expect(validateOnboardingAnswers([...GOAL_CODES, "x"], ["none"]).ok).toBe(false);
  });
  it("lets 'none' and 'not sure' stand alone only", () => {
    expect(validateOnboardingAnswers(["stay_ahead"], ["none", "asthma"])).toEqual({ ok: false, reason: "mixed" });
    expect(validateOnboardingAnswers(["not_sure", "stay_ahead"], ["none"])).toEqual({ ok: false, reason: "mixed" });
  });
});

const ans = (goals: OnboardingAnswers["goals"], conditions: OnboardingAnswers["conditions"]): OnboardingAnswers => ({ goals, conditions });

describe("focusFromAnswers: Home cards change with the answers", () => {
  it("leads with readings and medicines for someone managing a condition", () => {
    expect(focusFromAnswers(ans(["manage_condition"], ["hypertension"])).map((f) => f.id)).toEqual(["log_readings", "medicines"]);
  });
  it("leads with the health check for someone staying ahead", () => {
    expect(focusFromAnswers(ans(["stay_ahead"], ["none"])).map((f) => f.id)).toEqual(["health_check", "vaccines"]);
  });
  it("shows the supported people for family care", () => {
    expect(focusFromAnswers(ans(["family_care"], ["none"])).map((f) => f.id)).toEqual(["family"]);
  });
  it("falls back to a neutral card for not sure", () => {
    expect(focusFromAnswers(ans(["not_sure"], ["none"])).map((f) => f.id)).toEqual(["explore"]);
  });
  it("is deterministic and never more than three", () => {
    const a = ans(["manage_condition", "stay_ahead", "family_care"], ["diabetes", "asthma"]);
    expect(focusFromAnswers(a)).toEqual(focusFromAnswers(a));
    expect(focusFromAnswers(a).length).toBeLessThanOrEqual(3);
  });
  it("different answers give different cards", () => {
    const a = focusFromAnswers(ans(["manage_condition"], ["hypertension"])).map((f) => f.id).join();
    const b = focusFromAnswers(ans(["stay_ahead"], ["none"])).map((f) => f.id).join();
    expect(a).not.toEqual(b);
  });
});

describe("planStepsFromAnswers", () => {
  it("builds from the answers alone", () => {
    expect(planStepsFromAnswers(ans(["manage_condition"], ["diabetes"]))).toEqual(["start_readings", "meet_care_team"]);
    expect(planStepsFromAnswers(ans(["not_sure"], ["none"]))).toEqual(["look_around"]);
  });
  it("never has more than four steps", () => {
    expect(planStepsFromAnswers(ans(["manage_condition", "stay_ahead", "family_care"], ["diabetes"])).length).toBeLessThanOrEqual(4);
  });
});

describe("answersFromRows", () => {
  it("reads valid rows and ignores junk", () => {
    expect(answersFromRows([{ question_code: "goals", answer: ["stay_ahead"] }, { question_code: "conditions", answer: ["none"] }])).toEqual(
      ans(["stay_ahead"], ["none"]),
    );
    expect(answersFromRows([{ question_code: "goals", answer: ["nope"] }, { question_code: "conditions", answer: ["none"] }])).toBeNull();
    expect(answersFromRows(null)).toBeNull();
  });
});
