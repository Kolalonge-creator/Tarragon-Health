import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findDuplicateIngredients, normaliseIngredient, splitIngredients } from "./ingredients";
import { INGREDIENT_CASES } from "./ingredients.fixtures";

describe("normaliseIngredient", () => {
  it("lower-cases, collapses punctuation and trims", () => {
    expect(normaliseIngredient("  Clavulanic-Acid! ")).toBe("clavulanic acid");
    expect(normaliseIngredient("")).toBe("");
  });
});

describe("splitIngredients", () => {
  it("splits combination names and removes repeats and blanks, sorted", () => {
    expect(splitIngredients("Amoxicillin and clavulanic acid")).toEqual(["amoxicillin", "clavulanic acid"]);
    expect(splitIngredients("B / a + b, c & d; e with f")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(splitIngredients(" , ")).toEqual([]);
  });
});

describe("findDuplicateIngredients (shared cases)", () => {
  for (const c of INGREDIENT_CASES) {
    it(c.name, () => {
      const got = findDuplicateIngredients(c.items).map((p) => `${p.a}|${p.b}|${p.shared.join(",")}`);
      expect(got).toEqual(c.pairs);
    });
  }
  it("gives the same answer whatever order the medicines are listed in", () => {
    const items = [
      { id: "c", generic: "Paracetamol" },
      { id: "a", generic: "Paracetamol and caffeine" },
      { id: "b", generic: "Caffeine" },
    ];
    expect(findDuplicateIngredients([...items].reverse())).toEqual(findDuplicateIngredients(items));
  });
});

describe("the database proof runs the same cases", () => {
  it("names every shared case", () => {
    const sql = readFileSync(resolve(process.cwd(), "../db/tests/s08y_medicine_safety.sql"), "utf8");
    for (const c of INGREDIENT_CASES) expect(sql).toContain(`'${c.name}'`);
  });
});
