import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_RED_FLAG_RULE_ID, LIVE_RED_FLAG_RULE_VERSION, livePromptsForSegment } from "./live-redflag";
import { WRITTEN_QUESTION_DANGER_PHRASES } from "./written-question-screen";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "supabase", "migrations");

describe("live red-flag matcher", () => {
  it("raises a prompt carrying the list phrase, the rule id and the rule version", () => {
    expect(livePromptsForSegment("Patient: I have had chest pain since morning")).toEqual([
      { phrase: "chest pain", ruleId: LIVE_RED_FLAG_RULE_ID, ruleVersion: LIVE_RED_FLAG_RULE_VERSION },
    ]);
  });

  it("raises one prompt per distinct phrase in a segment", () => {
    const phrases = livePromptsForSegment("chest pain and I can't breathe, my lips are turning blue").map((p) => p.phrase);
    expect(phrases).toEqual(["chest pain", "can't breathe", "turning blue"]);
  });

  it("leaves out a phrase that is already showing, and keeps the others", () => {
    expect(livePromptsForSegment("chest pain, seizure", ["chest pain"]).map((p) => p.phrase)).toEqual(["seizure"]);
  });

  it("raises nothing for an ordinary segment", () => {
    expect(livePromptsForSegment("Doctor: any problems with your tablets? Patient: no, all fine")).toEqual([]);
  });

  it("raises nothing for a blank segment", () => {
    expect(livePromptsForSegment("")).toEqual([]);
    expect(livePromptsForSegment("   \n ")).toEqual([]);
  });

  it("every phrase on the signed list raises a prompt (no dead phrase), with no already-shown list given", () => {
    for (const phrase of WRITTEN_QUESTION_DANGER_PHRASES) {
      expect(livePromptsForSegment(`Patient: ${phrase} today`).map((p) => p.phrase)).toContain(phrase);
    }
  });

  it("is the rule id the database accepts (drift fails the build)", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s77_live_redflag_prompts_engine.sql"));
    if (!file) throw new Error("S77 live prompts migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    expect(sql).toContain(`rule_id = '${LIVE_RED_FLAG_RULE_ID}'`);
    expect(sql).toContain(`p_rule_id text default '${LIVE_RED_FLAG_RULE_ID}'`);
    expect(sql).toContain(`p_rule_version integer default ${LIVE_RED_FLAG_RULE_VERSION}`);
  });
});
