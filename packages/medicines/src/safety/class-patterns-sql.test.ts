import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyDrug, CLASS_PATTERNS } from "./drug-safety";
import { classPatternValuesSql, classPatternsForSql, toPostgresPattern } from "./class-patterns-sql";

// T2-11b: the database signing check classifies drugs with a COPY of CLASS_PATTERNS (private.drug_class_patterns). This keeps the copy
// in the migration identical to the code, so the add check and the signing check cannot disagree about what class a drug is in.

const MIGRATIONS = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));
const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_t2_11b_prescribing_safety_gaps.sql"));
const SQL = file ? readFileSync(MIGRATIONS + file, "utf8") : "";

describe("drug class patterns in the database", () => {
  it("the migration exists and carries every pattern, in order, exactly as the code has it", () => {
    expect(file).toBeDefined();
    expect(SQL).toContain(classPatternValuesSql());
    expect(classPatternsForSql()).toHaveLength(CLASS_PATTERNS.length);
  });

  it("writes the word boundary the way Postgres reads it and leaves the rest alone", () => {
    expect(toPostgresPattern("\\b(verapamil|diltiazem)\\b")).toBe("\\y(verapamil|diltiazem)\\y");
    expect(toPostgresPattern("(\\w+pril)\\b")).toBe("(\\w+pril)\\y");
    // nothing in the list uses a construct that means something else in Postgres
    for (const p of CLASS_PATTERNS) expect(p.pattern.source).not.toMatch(/\(\?|\\d|\\B|\\s/);
  });

  it("the cases the database proof checks classify the same way here", () => {
    expect(classifyDrug("Lisinopril/HCTZ 10/12.5mg").sort()).toEqual(["ace_inhibitor", "thiazide_diuretic"]);
    expect(classifyDrug("Amoxicillin 500mg capsules")).toEqual(["penicillin"]);
    expect(classifyDrug("Folic acid")).toEqual([]);
    expect(classifyDrug("Ibuprofen 400mg")).toEqual(["nsaid"]);
    expect(classifyDrug("Warfarin 5mg")).toEqual(["anticoagulant"]);
  });

  it("the check can fail: a changed pattern is no longer found in the migration", () => {
    const changed = classPatternValuesSql().replace("verapamil", "verapamill");
    expect(SQL).not.toContain(changed);
  });
});
