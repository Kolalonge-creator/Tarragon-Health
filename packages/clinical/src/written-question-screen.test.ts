import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { screenWrittenQuestion, WRITTEN_QUESTION_DANGER_PHRASES } from "./written-question-screen";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "supabase", "migrations");

describe("written question danger screen", () => {
  it("flags a plain danger phrase", () => {
    const r = screenWrittenQuestion("I have chest pain since this morning");
    expect(r.redFlag).toBe(true);
    expect(r.matched).toEqual(["chest pain"]);
  });

  it("is case insensitive and accepts a curly apostrophe from a phone keyboard", () => {
    expect(screenWrittenQuestion("I CAN’T BREATHE properly").redFlag).toBe(true);
    expect(screenWrittenQuestion("My baby is NOT BREATHING").matched).toContain("not breathing");
  });

  it("does not flag an ordinary question", () => {
    const r = screenWrittenQuestion("Can I take my tablets with food or not?");
    expect(r).toEqual({ redFlag: false, matched: [] });
  });

  it("flags every phrase on the list (no phrase is dead)", () => {
    for (const phrase of WRITTEN_QUESTION_DANGER_PHRASES) {
      expect([phrase, screenWrittenQuestion(`please help, ${phrase} now`).redFlag]).toEqual([phrase, true]);
    }
  });

  it("is the same list the database screens with (drift fails the build)", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_care_message_safety_screening.sql"));
    if (!file) throw new Error("care message safety screening migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const body = /from unnest\(array\[([\s\S]*?)\]\) as phrase/.exec(sql)?.[1];
    if (!body) throw new Error("phrase list not found in the migration");
    const phrases = [...body.matchAll(/'((?:[^']|'')*)'/g)].map((m) => (m[1] ?? "").replace(/''/g, "'"));
    expect(phrases).toEqual([...WRITTEN_QUESTION_DANGER_PHRASES]);
  });
});
