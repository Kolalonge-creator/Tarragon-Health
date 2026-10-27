import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Alert-tone lint (UI-C change 12, docs/research/S66-S70-design-ui-comparison.md section 4 and 5):
 *
 *   1. Patient-facing strings in packages/i18n never say "WARNING" and never use an exclamation mark.
 *   2. Cards that are NOT clinical alerts never use red styling. Red is kept for true clinical alerts only (brand guide).
 *
 * Scope is chosen so the test passes on the current tree without weakening it:
 *   - rule 1 covers every string-valued `"key": "text"` line in packages/i18n/src (zero offenders today, so the allowance is empty);
 *   - rule 2 is STRICT for the files in NON_CLINICAL_STRICT, and a RATCHET for the other web patient `*card*.tsx` files: the files in
 *     KNOWN_RED_CARD_OFFENDERS already use red and are listed in docs/OPEN-QUESTIONS.md; the list may only shrink, and a new card with
 *     red must either be fixed or be consciously added to CLINICAL_RED_OK (a real clinical alert).
 */
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const WEB_RED = /\b(?:text|bg|border|ring|fill|stroke|outline|divide|from|via|to|decoration|accent|caret|shadow)-(?:red|rose|destructive)(?:-\d{2,3}|\b)/;
const MOBILE_RED = /dangerText|dangerBg|tone="(?:danger|emergency)"/;

/** A hex colour that reads as red: strong red channel, weak green and blue. Catches #DC2626, #f00, #E11D48 and the like. */
export function hasHexRed(text: string): boolean {
  for (const m of text.matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)) {
    const h = m[1] as string;
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
    if (r >= 0xb0 && g <= 0x60 && b <= 0x70) return true;
  }
  return false;
}
const isRedLine = (line: string, web: boolean): boolean => (web ? WEB_RED.test(line) : MOBILE_RED.test(line)) || hasHexRed(line);
const BANNED_WORDS = /\bWARNING\b|\bWarning:/;

/** A string value that carries "!" as punctuation: "Done!", "Really?!", "Wait...!", "Done !" (but not `!=`, `!==` or `!x`). */
function hasExclamation(text: string): boolean {
  return /!(?!=)(?=\s|$)/.test(text);
}

export function toneProblems(text: string): string[] {
  const out: string[] = [];
  if (BANNED_WORDS.test(text)) out.push("warning-word");
  if (hasExclamation(text)) out.push("exclamation");
  return out;
}

/** Code lines only: comments are ignored. */
function codeLines(src: string): string[] {
  return src.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*|\{\s*\/\*)/.test(l));
}

/**
 * Every double-quoted string literal in a source file, with its line number, comments removed. Works on the whole text rather than
 * line by line, so a value on the line after its key, a concatenated value and a template-like entry are all seen.
 */
export function stringLiterals(src: string): { text: string; line: number }[] {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
  const out: { text: string; line: number }[] = [];
  for (const m of stripped.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    out.push({ text: m[1] as string, line: stripped.slice(0, m.index).split("\n").length });
  }
  return out;
}

describe("alert-tone lint: patient-facing strings", () => {
  const dir = "packages/i18n/src";
  const files = readdirSync(join(repoRoot, dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("scans a meaningful number of strings (a silently empty scan must fail)", () => {
    let n = 0;
    for (const f of files) n += stringLiterals(read(`${dir}/${f}`)).length;
    expect(n).toBeGreaterThan(1000);
  });

  it("has no WARNING and no exclamation mark in any string value", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const lit of stringLiterals(read(`${dir}/${f}`))) {
        if (toneProblems(lit.text).length > 0) offenders.push(`${dir}/${f}:${lit.line} ${lit.text.slice(0, 40)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the detector discriminates", () => {
    expect(toneProblems("WARNING: act now")).toContain("warning-word");
    expect(toneProblems("Please call us!")).toContain("exclamation");
    expect(toneProblems("Saved on this phone. It will send when you are online.")).toEqual([]);
    expect(toneProblems("a !== b")).toEqual([]);
    expect(toneProblems("a != b, !flag")).toEqual([]);
    expect(toneProblems("Are you sure?!")).toContain("exclamation");
    expect(toneProblems("Take care...!")).toContain("exclamation");
    expect(toneProblems("Done !")).toContain("exclamation");
    expect(toneProblems("Hello!")).toContain("exclamation");
    expect(toneProblems("Warning: this")).toContain("warning-word");
  });

  it("sees a multi-line entry, where the value sits on the line after its key", () => {
    const src = '  "a.b":\n    "Please hurry!",\n  "c.d": "fine",\n  // "x": "ignored!"\n';
    const lits = stringLiterals(src);
    expect(lits.map((l) => l.text)).toEqual(["a.b", "Please hurry!", "c.d", "fine"]);
    expect(lits.filter((l) => toneProblems(l.text).length > 0).map((l) => l.line)).toEqual([2]);
  });
});

/** Cards that explain a state, a device or a reminder. None is a clinical alert, so none may use red. */
const NON_CLINICAL_STRICT_WEB = [
  "apps/web/src/app/(dashboard)/patient/device-sync-support-card.tsx",
  "apps/web/src/app/(dashboard)/patient/sleep-summary-card.tsx",
];
const NON_CLINICAL_STRICT_MOBILE = [
  "apps/mobile/src/screens/devices-screen.tsx",
  "apps/mobile/src/ui/log-queue-note.tsx",
  "apps/mobile/src/lib/device-row-view.ts",
];
/** Real clinical alerts: red is allowed here. */
const CLINICAL_RED_OK = new Set<string>(["pregnancy-red-flag-check.tsx", "danger-symptom-check.tsx"]);
/** Pre-existing web patient cards that already use red. Listed in docs/OPEN-QUESTIONS.md (UI-C). May only shrink. */
const KNOWN_RED_CARD_OFFENDERS = new Set<string>([
  "annual-bundle-card.tsx", // arrived from main-dev after the first list was taken: red error text
  "ask-tarragon-card.tsx",
  "cancer-screening-card.tsx",
  "communication-history-card.tsx",
  "developmental-screening-card.tsx",
  "goals-and-milestones-card.tsx",
  "device-data-deletion-card.tsx",
  "growth-tracking-card.tsx",
  "hbpm-summary-card.tsx",
  "held-readings-card.tsx",
  "health-check-video-consult-card.tsx",
  "hospital-admissions-card.tsx",
  "lab-monitoring-card.tsx",
  "lab-trend-card.tsx",
  "nutrition-support-card.tsx",
  "maternal-child-cards.tsx",
  "optional-screenings-card.tsx",
  "reproductive-health-card.tsx",
  "verified-documents-card.tsx",
  "senior-case-review-card.tsx",
  "services-promo-card.tsx",
  "wearable-connect-card.tsx",
  "skin-photo-card.tsx",
  "vaccination-card-import.tsx",
  "written-question-card.tsx",
  "weekly-summary-card.tsx",
]);

describe("alert-tone lint: no red on non-clinical cards", () => {
  it("keeps red out of the device, sync and queue surfaces", () => {
    // A missing file throws: a renamed or deleted card must be updated here, never silently skipped.
    for (const rel of NON_CLINICAL_STRICT_WEB) {
      expect([rel, codeLines(read(rel)).filter((l) => isRedLine(l, true))]).toEqual([rel, []]);
    }
    for (const rel of NON_CLINICAL_STRICT_MOBILE) {
      expect([rel, codeLines(read(rel)).filter((l) => isRedLine(l, false))]).toEqual([rel, []]);
    }
  });

  it("RATCHET: web patient cards with red are only the known ones", () => {
    const dir = "apps/web/src/app/(dashboard)/patient";
    const cards = readdirSync(join(repoRoot, dir)).filter((f) => /card.*\.tsx$/.test(f) && !f.endsWith(".test.tsx"));
    expect(cards.length).toBeGreaterThan(40);
    const withRed = cards.filter((f) => codeLines(read(`${dir}/${f}`)).some((l) => isRedLine(l, true)));
    const unexpected = withRed.filter((f) => !KNOWN_RED_CARD_OFFENDERS.has(f) && !CLINICAL_RED_OK.has(f));
    expect(unexpected).toEqual([]);
    // The list may only shrink: a card that has been fixed must be removed from it.
    const fixed = [...KNOWN_RED_CARD_OFFENDERS].filter((f) => cards.includes(f) && !withRed.includes(f));
    expect(fixed).toEqual([]);
  });

  it("the red detector discriminates", () => {
    expect(WEB_RED.test('className="text-red-600 dark:text-red-300"')).toBe(true);
    expect(WEB_RED.test('className="text-charcoal-ink"')).toBe(false);
    expect(WEB_RED.test('className="bg-rose-50 text-destructive"')).toBe(true);
    expect(WEB_RED.test('className="border-red-200"')).toBe(true);
    expect(WEB_RED.test('className="text-brand-green bg-green-100"')).toBe(false);
    expect(isRedLine('borderLeftColor: "#DC2626"', false)).toBe(true);
    expect(isRedLine('color: "#f00"', false)).toBe(true);
    expect(isRedLine('color: "#E11D48"', false)).toBe(true);
    expect(isRedLine('tone="danger"', false)).toBe(true);
    expect(isRedLine('color: "#0E7C52"', false)).toBe(false);
    expect(isRedLine('color: "#FFFFFF"', false)).toBe(false);
    expect(isRedLine("color: colors.brand", false)).toBe(false);
  });
});
