import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allStrings, causalWordingHits, CAUSAL_PATTERN, NEGATION_PATTERN } from "./causal-wording";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "supabase", "migrations");

describe("causalWordingHits", () => {
  it("catches a claim of cause", () => {
    expect(causalWordingHits("Blood pressure fell because of the programme.")).toEqual(["because of the programme"]);
    expect(causalWordingHits("The programme caused the improvement. Members saved money.")).toEqual(["caused", "saved"]);
    expect(causalWordingHits("Return on investment was strong")).toEqual(["return on investment"]);
  });
  it("allows a sentence that states a limit", () => {
    expect(causalWordingHits("This does not show that the programme caused any change.")).toEqual([]);
    expect(causalWordingHits("There is no comparison group, so nothing here can show what led to the change.")).toEqual([]);
  });
  it("reads every string in a document", () => {
    expect(causalWordingHits(allStrings({ a: ["fine"], b: { c: "It resulted in lower blood pressure" }, d: 3 }))).toEqual(["resulted in"]);
  });
  it("does not trip on ordinary words", () => {
    expect(causalWordingHits("Members who stayed logged readings; the average fell by 4 points")).toEqual([]);
  });
});

describe("the wording patterns mirror the database", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s75c_retention_quality_response_times_pack.sql"));
  const sql = file ? readFileSync(join(MIGRATIONS, file), "utf8") : "";
  const block = /causal-pattern-begin\n-- (\\m\(.*\)\\M)\n-- causal-negation: (.*)\n-- causal-pattern-end/.exec(sql);
  it("finds the markers", () => expect(block).not.toBeNull());
  it("causal pattern is identical", () => expect(block?.[1]?.replaceAll("\\m", "\\b").replaceAll("\\M", "\\b")).toBe(CAUSAL_PATTERN));
  it("negation pattern is identical", () => expect(block?.[2]?.replaceAll("\\m", "\\b").replaceAll("\\M", "\\b")).toBe(NEGATION_PATTERN));
  it("the function body in the migration uses the same list", () => {
    const body = /regexp_matches\(s, '(\\m\(.*?\)\\M)'/.exec(sql);
    expect(body?.[1]?.replaceAll("\\m", "\\b").replaceAll("\\M", "\\b")).toBe(CAUSAL_PATTERN);
  });
});
