import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function seed(marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s55_learning_centre_foundation.sql"));
  if (!file) throw new Error("S55 foundation migration not found");
  const m = new RegExp(`learning-${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!m?.[1]) throw new Error(`seed ${marker} not found in the migration`);
  return JSON.parse(m[1]);
}

describe("learning.* configuration mirrors the learning_config seeds", () => {
  it("micro_lesson", () => expect(seed("micro-lesson")).toEqual(getProposedConfig("learning.micro_lesson").value));
  it("offline_pack", () => expect(seed("offline-pack")).toEqual(getProposedConfig("learning.offline_pack").value));
  it("search_gap_log", () => expect(seed("search-gap")).toEqual(getProposedConfig("learning.search_gap_log").value));
  it("search_synonyms", () =>
    expect(seed("synonyms")).toEqual((getProposedConfig("learning.search_synonyms").value as { groups: unknown }).groups));

  it("every value is proposed and unsigned (no sign-off was created)", () => {
    for (const k of ["micro_lesson", "offline_pack", "search_gap_log", "search_synonyms"]) {
      expect(getProposedConfig(`learning.${k}`).status).toBe("proposed");
    }
  });
});
