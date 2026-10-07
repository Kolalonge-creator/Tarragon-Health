import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("symptom.adult_age_years mirrors the database", () => {
  it("is the number returned by private.symptom_checker_adult_age()", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s59b_children_members_and_closed_staff_read.sql"));
    if (!file) throw new Error("S59b migration not found");
    const m = /function private\.symptom_checker_adult_age\(\)[\s\S]*?\$\$ select (\d+) \$\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!m?.[1]) throw new Error("adult age function body not found");
    expect(Number(m[1])).toBe(getProposedConfig("symptom.adult_age_years").value);
  });
});
