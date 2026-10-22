import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";
import { HOME_PIN_KEYS, MAX_HOME_PINS } from "./home-pins";

const migrationsDir = new URL("../../../supabase/migrations/", import.meta.url);

/** The CHECK on patient_home_layout.pinned lives in SQL, so it can drift from the catalogue; this ties them together. */
describe("patient_home_layout CHECK matches the pin catalogue", () => {
  const file = readdirSync(migrationsDir).find((f) => f.endsWith("_patient_home_layout.sql"));
  const sql = file ? readFileSync(new URL(file, migrationsDir), "utf8") : "";

  it("finds the migration", () => {
    expect(file).toBeDefined();
  });

  it("allows exactly the keys in HOME_PIN_KEYS", () => {
    const block = /pinned <@ array\[([\s\S]*?)\]::text\[\]/.exec(sql)?.[1] ?? "";
    const keys = [...block.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
    expect([...keys].sort()).toEqual([...HOME_PIN_KEYS].sort());
  });

  it("caps the list at MAX_HOME_PINS", () => {
    const cap = /cardinality\(pinned\) <= (\d+)/.exec(sql)?.[1];
    expect(Number(cap)).toBe(MAX_HOME_PINS);
  });
});
