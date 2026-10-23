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

/** Every quoted literal and every piece of JSX text that holds an exclamation mark. Logic such as !done or a !== b is not text and is ignored. */
function exclamations(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`|>([^<>{}\n]+)</g)) {
    const text = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    if (text.includes("!")) out.push(text);
  }
  return out;
}

describe("cycle screen copy rules", () => {
  it.each(FILES)("%s has no WARNING and no exclamation mark in any string or text", (f) => {
    const src = code(read(f));
    expect(src).not.toMatch(/warning/i);
    expect(exclamations(src)).toEqual([]);
  });

  it("the exclamation check catches '?!', ' !' and '...!' in a literal or in JSX text", () => {
    expect(exclamations('const a = "Really?!";').length).toBe(1);
    expect(exclamations("const a = 'Well done !';").length).toBe(1);
    expect(exclamations("const a = `Wait...!`;").length).toBe(1);
    expect(exclamations("<AppText>Saved!</AppText>").length).toBe(1);
    expect(exclamations("const ok = !done && a !== b;").length).toBe(0);
  });

  it.each(["ui/cycle-status-card.tsx", "ui/cycle-date-picker.tsx"])("%s uses no red", (f) => {
    expect(code(read(f))).not.toMatch(/danger|emergency/i);
  });

  it("the screen uses red only on the urgent-flag card and on the two error lines (planning-mode save, action error)", () => {
    const whole = code(read("screens/sections/cycle-screen.tsx"));
    const flagsStart = whole.indexOf("function FlagsCard");
    const flagsEnd = whole.indexOf("function GroupHeading");
    expect(flagsStart).toBeGreaterThan(0);
    const outsideFlags = whole.slice(0, flagsStart) + whole.slice(flagsEnd);
    const matches = [...outsideFlags.matchAll(/dangerText/g)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const around = outsideFlags.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + 200);
      expect(around).toMatch(/cycle\.planning_mode\.error|actionError/);
    }
    expect(whole).not.toMatch(/colors\.danger\b|tone="emergency"/);
  });

  it.each(["screens/sections/cycle-screen.tsx", "ui/cycle-parts.tsx", "ui/cycle-status-card.tsx", "ui/cycle-date-picker.tsx", "ui/cycle-danger-signs.tsx"])(
    "%s has no hard-coded colour and no legacy static colours (it stays scheme-aware through the kit)",
    (f) => {
      const src = code(read(f));
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src).not.toMatch(/rgba?\(/);
      expect(src).not.toMatch(/from\s*"@\/ui\/theme"/);
      expect(src).not.toMatch(/from\s*"@\/ui\/components"/);
      expect(src).not.toMatch(/useLegacyColors|legacy-kit/);
    }
  );

  it("keeps 'Nothing here is required.' on the day log", () => {
    expect(cycleCopy["cycle.log.intro"]).toContain("Nothing here is required.");
  });

  it("the danger signs put the one step first, then noticed, meaning, then the message button", () => {
    const src = code(read("ui/cycle-danger-signs.tsx"));
    const order = ["step_label", "noticed_label", "meaning_label", "message_button"].map((k) => src.indexOf(k));
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
