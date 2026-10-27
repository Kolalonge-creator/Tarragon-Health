import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "@tarragon/i18n";

describe("written question card response time (S-9, 23.16)", () => {
  it("publishes no response-time number in the window or intro copy", () => {
    expect(t("wq.window", "en")).not.toMatch(/\d|hours/i);
    expect(t("wq.intro", "en")).not.toMatch(/\d|\{hours\}|within/i);
    expect(t("wq.window", "en")).not.toMatch(/Reply within/);
  });

  it("the card no longer renders a due window or passes an hours figure", () => {
    const src = readFileSync(join(__dirname, "written-question-card.tsx"), "utf8");
    expect(src).not.toMatch(/\{\s*hours\b/);
    expect(src).not.toMatch(/window_due_at/);
    expect(src).not.toMatch(/window_minutes/);
  });
});
