import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cycleCopy } from "@tarragon/i18n";

/**
 * UI-A rules for the cycle screen, checked from source (this package renders nothing in Jest): no "WARNING", no exclamation marks in
 * copy, red only where it is a true clinical alert (the danger-signs card and the engine's urgent flags), and the log button never
 * promises an offline save it does not make.
 */
const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const FILES = ["screens/sections/cycle-screen.tsx", "ui/cycle-parts.tsx", "ui/cycle-status-card.tsx", "ui/cycle-date-picker.tsx", "ui/cycle-danger-signs.tsx", "ui/cycle-privacy-controls.tsx"];

/** Source with comments removed, so a sentence in a comment is not read as screen copy. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("cycle screen copy rules", () => {
  it.each(FILES)("%s has no WARNING and no exclamation mark in text", (f) => {
    const src = code(read(f));
    expect(src).not.toMatch(/warning/i);
    expect(src).not.toMatch(/[A-Za-z.]!(["'`<]|\s*\{)/);
  });

  it.each(["ui/cycle-status-card.tsx", "ui/cycle-date-picker.tsx"])("%s uses no red", (f) => {
    expect(code(read(f))).not.toMatch(/danger|emergency/i);
  });

  it("the screen uses red only on the urgent-flag card and the planning/save error lines", () => {
    const src = code(read("screens/sections/cycle-screen.tsx"));
    const uses = [...src.matchAll(/dangerText/g)].length;
    // urgent flag icon + title, planning-mode error, action error, plus the flag card edge
    expect(uses).toBeLessThanOrEqual(6);
    expect(src).not.toMatch(/colors\.danger\b|tone="emergency"/);
  });

  it("keeps 'Nothing here is required.' on the day log", () => {
    expect(cycleCopy["cycle.log.intro"]).toContain("Nothing here is required.");
  });

  it("the danger signs follow the alert template: noticed, meaning, step, message button", () => {
    const src = code(read("ui/cycle-danger-signs.tsx"));
    const order = ["noticed_label", "meaning_label", "step_label", "message_button"].map((k) => src.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("claims 'saved on this phone' only through the queued state", () => {
    const parts = code(read("ui/cycle-parts.tsx"));
    expect(parts).toMatch(/state === "queued"[\s\S]{0,400}cycle\.offline\.saved/);
    expect(code(read("screens/sections/cycle-screen.tsx"))).toMatch(/heldOnPhone: false/);
  });

  it("shows no streak or missed-day wording", () => {
    for (const f of FILES) expect(code(read(f))).not.toMatch(/streak|you missed|broke your/i);
  });
});
