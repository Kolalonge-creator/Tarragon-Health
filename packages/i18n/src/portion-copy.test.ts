import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { en } from "./en";
import { portionPhrase } from "./portion-copy";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "..", "..", "supabase", "migrations");

/** Every { unit, per } the seeded portion configuration uses. */
function configuredLines(): { unit: string; per: string }[] {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_learning_record_lessons_and_portion_guide.sql")) as string;
  const m = /learning-portion-guide-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  const cfg = JSON.parse((m as RegExpExecArray)[1] as string) as { portions: Record<string, Record<string, { unit: string; per: string }>> };
  return Object.values(cfg.portions).flatMap((byAudience) => Object.values(byAudience));
}

describe("portion phrases", () => {
  it("say the amount, the right singular or plural unit and the time", () => {
    expect(portionPhrase({ amount: 1, unit: "fist", per: "meal" })).toBe("About 1 fist each meal");
    expect(portionPhrase({ amount: 2, unit: "fist", per: "meal" })).toBe("About 2 fists each meal");
    expect(portionPhrase({ amount: 1, unit: "cupped_hand", per: "day" })).toBe("About 1 cupped hand each day");
    expect(portionPhrase({ amount: 1, unit: "cube", per: "pot" })).toBe("About 1 seasoning cube for each pot");
    expect(portionPhrase({ amount: 0, unit: "cupped_hand", per: "week" })).toBe("Best to leave this out each week");
  });
  it("every unit and time the configuration uses has both wordings in the catalogue", () => {
    const lines = configuredLines();
    expect(lines.length).toBeGreaterThan(10);
    for (const { unit, per } of lines) {
      expect(en[`learn.portion.unit.${unit}.one` as keyof typeof en]).toBeTruthy();
      expect(en[`learn.portion.unit.${unit}.other` as keyof typeof en]).toBeTruthy();
      expect(en[`learn.portion.per.${per}` as keyof typeof en]).toBeTruthy();
    }
  });
});
