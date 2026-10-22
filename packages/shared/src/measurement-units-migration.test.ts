import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { LENGTH_DISPLAY_UNITS, TEMPERATURE_DISPLAY_UNITS, WEIGHT_DISPLAY_UNITS } from "./measurement-units";

// The catalogue and the database CHECKs are two lists that must agree: a unit added here but not in the
// migration would be rejected on save, and the reverse would leave a value the apps cannot render.
const sql = readFileSync(new URL("../../../supabase/migrations/20261022101500_profiles_measurement_display_units.sql", import.meta.url), "utf8");

function checkValues(column: string): string[] {
  const m = sql.match(new RegExp(`check \\(${column} in \\(([^)]*)\\)\\)`));
  expect(m).not.toBeNull();
  return [...(m?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
}

describe("measurement unit CHECKs mirror the catalogue", () => {
  it("weight", () => expect(checkValues("weight_display_unit")).toEqual([...WEIGHT_DISPLAY_UNITS]));
  it("temperature", () => expect(checkValues("temperature_display_unit")).toEqual([...TEMPERATURE_DISPLAY_UNITS]));
  it("length", () => expect(checkValues("length_display_unit")).toEqual([...LENGTH_DISPLAY_UNITS]));
});
