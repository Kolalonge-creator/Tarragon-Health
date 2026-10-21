import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OVERRIDE_LIMITS } from "./threshold-override";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "supabase", "migrations");

describe("the engine's hard clamps equal the database's clamps", () => {
  it("OVERRIDE_LIMITS is identical to private.threshold_override_limits()", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_n_patient_threshold_overrides.sql"));
    if (!file) throw new Error("N-overrides migration not found");
    const match = /override-limits-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("limits not found in the migration");
    expect(JSON.parse(match[1])).toEqual(JSON.parse(JSON.stringify(OVERRIDE_LIMITS)));
  });
});
