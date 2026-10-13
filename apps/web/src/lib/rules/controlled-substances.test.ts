import * as fs from "node:fs";
import * as path from "node:path";
import { controlledSubstanceInfo } from "./controlled-substances";

describe("controlledSubstanceInfo", () => {
  it("flags a narcotic-class opioid", () => {
    const result = controlledSubstanceInfo("Morphine");
    expect(result?.tier).toBe("narcotic");
    expect(result?.label).toBe("Opioid analgesic");
  });

  it("flags a lower-schedule opioid as restricted, not narcotic", () => {
    expect(controlledSubstanceInfo("Tramadol")?.tier).toBe("restricted");
  });

  it("flags a benzodiazepine as restricted", () => {
    expect(controlledSubstanceInfo("Diazepam 5mg")?.tier).toBe("restricted");
  });

  it("flags a stimulant as narcotic", () => {
    expect(controlledSubstanceInfo("Methylphenidate")?.tier).toBe("narcotic");
  });

  it("matches case-insensitively and with a dose suffix", () => {
    expect(controlledSubstanceInfo("codeine 30mg")).not.toBeNull();
  });

  it("returns null for an ordinary, non-controlled drug", () => {
    expect(controlledSubstanceInfo("Amlodipine")).toBeNull();
    expect(controlledSubstanceInfo("Metformin")).toBeNull();
  });

  it("returns null for an empty or whitespace-only name", () => {
    expect(controlledSubstanceInfo("")).toBeNull();
    expect(controlledSubstanceInfo("   ")).toBeNull();
  });

  it("does not false-positive on a substring collision", () => {
    // "Codeine" must not match inside an unrelated word.
    expect(controlledSubstanceInfo("Encodeinate")).toBeNull();
  });
});

describe("brand names and combinations (OQ-276, CMO 2026-10-12)", () => {
  it.each([
    ["Tramal 50mg", "restricted"],
    ["Valium 5mg", "restricted"],
    ["Ativan", "restricted"],
    ["Xanax XR", "restricted"],
    ["Rivotril 0.5mg", "restricted"],
    ["Lexotan 3mg", "restricted"],
    ["Phensedyl syrup", "restricted"],
    ["Solpadeine Max", "restricted"],
    ["co-codamol 30/500", "restricted"],
    ["cocodamol", "restricted"],
    ["Ritalin LA", "narcotic"],
    ["Adderall", "narcotic"],
    ["Percocet 5/325", "narcotic"],
    ["OxyContin 10mg", "narcotic"],
  ])("flags %s as %s", (name, tier) => {
    expect(controlledSubstanceInfo(name)?.tier).toBe(tier);
  });

  it("flags phenobarbitone as well as phenobarbital (the older pattern matched only 'phenobarbitalone')", () => {
    expect(controlledSubstanceInfo("Phenobarbitone 30mg")?.tier).toBe("restricted");
    expect(controlledSubstanceInfo("Phenobarbital")?.tier).toBe("restricted");
  });

  it("does not flag ordinary medicines or look-alike words", () => {
    for (const name of ["Panadol Extra", "Paracetamol 500mg", "Ventolin", "Ultrasound gel", "Concertina", "Valiumx"]) {
      expect(controlledSubstanceInfo(name)).toBeNull();
    }
  });
});

/**
 * The database list (private.is_controlled_medicine, the newest migration that defines it) and this file are two copies of ONE list. They cannot be
 * generated from each other, so this test fails the moment they drift: every word the database controls must be flagged here, and every word flagged
 * here must be controlled in the database.
 */
describe("the TypeScript list matches the database list", () => {
  const migrations = path.resolve(__dirname, "../../../../../supabase/migrations");
  const files = fs.readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  const defining = files.filter((f) => /create or replace function private\.is_controlled_medicine/.test(fs.readFileSync(path.join(migrations, f), "utf8")));
  const latest = fs.readFileSync(path.join(migrations, defining[defining.length - 1]), "utf8");
  const sqlAlternatives = (/~\* '\\m\(([^)]*)\)\\M'/.exec(latest.slice(latest.indexOf("create or replace function private.is_controlled_medicine")))?.[1] ?? "").split("|");

  const source = fs.readFileSync(path.resolve(__dirname, "controlled-substances.ts"), "utf8");
  const tsWords = [...source.matchAll(/pattern: \/\\b\(([^)]*(?:\([^)]*\))?[^)]*)\)\\b\/i|pattern: \/\\b([a-z]+)\\b\/i/g)].flatMap((m) =>
    (m[1] ?? m[2]).split("|").map((w) => w.replace("co-?", "co")),
  );

  it("found both lists, including words from every pattern (a pattern shape the parser cannot read would drop its words)", () => {
    expect(sqlAlternatives.length).toBeGreaterThan(40);
    expect(tsWords.length).toBeGreaterThan(40);
    // one sentinel from each of the six patterns, so a pattern that stops being read fails here instead of silently shrinking the comparison
    for (const w of ["morphine", "tramal", "valium", "ritalin", "luminal", "ketalar", "phenobarbitone", "cocodamol"]) expect(tsWords).toContain(w);
  });

  it("every word the database controls is flagged here", () => {
    for (const alt of sqlAlternatives) {
      const samples = alt.includes("-?") ? [alt.replace("-?", "-"), alt.replace("-?", "")] : [alt];
      for (const s of samples) expect({ word: s, flagged: controlledSubstanceInfo(s) !== null }).toEqual({ word: s, flagged: true });
    }
  });

  it("every word flagged here is controlled in the database", () => {
    const sql = new Set(sqlAlternatives.map((a) => a.replace("-?", "")));
    for (const w of tsWords) expect({ word: w, inDatabase: sql.has(w) || sql.has(w.replace("co", "co-?")) }).toEqual({ word: w, inDatabase: true });
  });
});
