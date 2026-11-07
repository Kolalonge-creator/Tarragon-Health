/**
 * P22 (PR #1808): the web card asks for a kind of help first and has its own intro (circle.help.introTyped). The phone card is still the
 * one-tap alarm, so it must keep showing exactly the intro it showed before. This package does not render components (see jest.config),
 * so the card's source is read and the catalogue text checked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "@tarragon/i18n";

const OLD_INTRO =
  "One tap tells the people in your Care Circle who can receive alerts that you want them to call you. It does not replace getting care. If you need care now, go to the nearest hospital.";

describe("phone help card intro", () => {
  const src = readFileSync(join(__dirname, "care-circle-help-card.tsx"), "utf8");

  it("uses the one-tap intro key, not the web card's typed intro", () => {
    expect(src).toContain('t("circle.help.intro", locale)');
    expect(src).not.toContain("circle.help.introTyped");
  });

  it("the one-tap intro reads exactly as it did before", () => {
    expect(t("circle.help.intro", "en")).toBe(OLD_INTRO);
  });
});
