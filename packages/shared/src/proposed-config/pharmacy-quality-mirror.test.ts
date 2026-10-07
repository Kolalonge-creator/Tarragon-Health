import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("pharmacy.quality mirrors the migration seed", () => {
  it("the licence-days rule in pharmacy_quality_config v1 equals the registry value, and both are marked PROPOSED", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s28_pharmacy_collection.sql"));
    if (!file) throw new Error("S28 migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const match = /insert into public\.pharmacy_quality_config[^;]*?values \(1, (\d+), true, true,/.exec(sql);
    if (!match?.[1]) throw new Error("pharmacy quality seed not found in the migration");
    expect({ min_licence_days_left: Number(match[1]) }).toEqual(getProposedConfig("pharmacy.quality").value);
    expect(getProposedConfig("pharmacy.quality").status).toBe("proposed");
  });
});
