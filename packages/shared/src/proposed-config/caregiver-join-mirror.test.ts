import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_cgj_caregiver_in_consultation.sql"));
  if (!file) throw new Error("CGJ migration not found");
  const match = /caregiver-join-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error("caregiver join seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("consultations.caregiver_join mirrors the migration seed", () => {
  it("is identical to consultation_caregiver_config version 1, so the registry and the database cannot drift", () => {
    expect(seed()).toEqual(getProposedConfig("consultations.caregiver_join").value);
  });

  it("is proposed, owned by the founder, and holds exactly the keys the database validates", () => {
    const e = getProposedConfig("consultations.caregiver_join");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    expect(Object.keys(e.value as object).sort()).toEqual(["inviteExpiryMinutes", "maxCaregiversPerCall", "minAgeYears", "requireDateOfBirth"]);
  });

  it("holds the conservative defaults: one invited person per call, adults only", () => {
    const v = getProposedConfig<{ maxCaregiversPerCall: number; minAgeYears: number }>("consultations.caregiver_join").value;
    expect(v.maxCaregiversPerCall).toBe(1);
    expect(v.minAgeYears).toBe(18);
  });
});
