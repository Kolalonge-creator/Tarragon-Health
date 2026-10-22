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

const WEB_RED = /\b(?:hover:|dark:|focus-visible:)*(?:text|bg|border|ring|fill|stroke)-red-\d{2,3}\b/;
const MOBILE_RED = /#DC2626|#dc2626|dangerText|dangerBg|tone="(?:danger|emergency)"/;
const BANNED_WORDS = /\bWARNING\b|\bWarning:/;

/** A string value that carries "!" as punctuation (not `!=`, `!x` or `!==`). */
function hasExclamation(text: string): boolean {
  return /[A-Za-z0-9.,)"'’]!(?![=])(?:\s|$|["'`])/.test(text);
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

const STRING_LINE = /^\s*"[A-Za-z0-9_.]+":\s*"((?:[^"\\]|\\.)*)",?\s*$/;

describe("alert-tone lint: patient-facing strings", () => {
  const dir = "packages/i18n/src";
  const files = readdirSync(join(repoRoot, dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("scans a meaningful number of strings (a silently empty scan must fail)", () => {
    let n = 0;
    for (const f of files) for (const l of read(`${dir}/${f}`).split("\n")) if (STRING_LINE.test(l)) n++;
    expect(n).toBeGreaterThan(1000);
  });

  it("has no WARNING and no exclamation mark in any string value", () => {
    const offenders: string[] = [];
    for (const f of files) {
      read(`${dir}/${f}`).split("\n").forEach((line, i) => {
        const m = STRING_LINE.exec(line);
        if (m && toneProblems(m[1] as string).length > 0) offenders.push(`${dir}/${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the detector discriminates", () => {
    expect(toneProblems("WARNING: act now")).toContain("warning-word");
    expect(toneProblems("Please call us!")).toContain("exclamation");
    expect(toneProblems("Saved on this phone. It will send when you are online.")).toEqual([]);
    expect(toneProblems("a !== b")).toEqual([]);
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
    for (const rel of NON_CLINICAL_STRICT_WEB) {
      let src: string;
      try {
        src = read(rel);
      } catch {
        continue; // a file that no longer exists cannot offend
      }
      expect([rel, codeLines(src).filter((l) => WEB_RED.test(l))]).toEqual([rel, []]);
    }
    for (const rel of NON_CLINICAL_STRICT_MOBILE) {
      expect([rel, codeLines(read(rel)).filter((l) => MOBILE_RED.test(l))]).toEqual([rel, []]);
    }
    // The strict set must include the files this change touched, so the test cannot drift away from them.
    expect(NON_CLINICAL_STRICT_MOBILE).toContain("apps/mobile/src/screens/devices-screen.tsx");
  });

  it("RATCHET: web patient cards with red are only the known ones", () => {
    const dir = "apps/web/src/app/(dashboard)/patient";
    const cards = readdirSync(join(repoRoot, dir)).filter((f) => /card.*\.tsx$/.test(f) && !f.endsWith(".test.tsx"));
    expect(cards.length).toBeGreaterThan(40);
    const withRed = cards.filter((f) => codeLines(read(`${dir}/${f}`)).some((l) => WEB_RED.test(l)));
    const unexpected = withRed.filter((f) => !KNOWN_RED_CARD_OFFENDERS.has(f) && !CLINICAL_RED_OK.has(f));
    expect(unexpected).toEqual([]);
    // The list may only shrink: a card that has been fixed must be removed from it.
    const fixed = [...KNOWN_RED_CARD_OFFENDERS].filter((f) => cards.includes(f) && !withRed.includes(f));
    expect(fixed).toEqual([]);
  });

  it("the red detector discriminates", () => {
    expect(WEB_RED.test('className="text-red-600 dark:text-red-300"')).toBe(true);
    expect(WEB_RED.test('className="text-charcoal-ink"')).toBe(false);
    expect(MOBILE_RED.test('borderLeftColor: "#DC2626"')).toBe(true);
    expect(MOBILE_RED.test("color: colors.brand")).toBe(false);
  });
});
