import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasPidgin } from "@tarragon/shared";

/**
 * The five web lifestyle tracker screens (sleep/smoking/alcohol/activity/
 * nutrition) call `t("...")` on their static chrome -- card titles, field
 * labels, buttons, empty/loading/success states -- the same way
 * navigation-pidgin-coverage.test.ts checks the nav. Unlike nav, there is no
 * single array of these strings to import, so this scans the actual source
 * for every `t("...")` call and checks the dictionary directly. That is a
 * stronger tripwire than a hand-maintained list (used for the mobile
 * trackers, in packages/shared/src/ui-language.test.ts, because there is no
 * equivalent literal source to scan on that side): it can't drift out of
 * sync with the files it is meant to guard.
 *
 * Deliberately NOT covered by this scan, matching the boundary in
 * ui-language.ts's comment above the entries for this section: enum-driven
 * labels defined in packages/shared validation files (SMOKING_STATUS_LABELS
 * and friends) and any sentence assembled from clinical/guidance content
 * generated at runtime -- neither is a `t("...")` call site to begin with.
 */
const TRACKER_FILES = [
  "sleep/sleep-client.tsx",
  "smoking/smoking-client.tsx",
  "alcohol/alcohol-client.tsx",
  "activity/activity-client.tsx",
  "nutrition-flow.tsx",
];

const PATIENT_DIR = join(__dirname);

/** Matches `t("...")`, `t('...')` and the multi-line `t(\n  "..."\n)` form
 * used for the longer paragraphs above; deliberately does not attempt
 * template literals, since no call site here uses one. */
const T_CALL = /\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

function stringsCalledWithT(source: string): string[] {
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = T_CALL.exec(source))) {
    // eslint-disable-next-line no-eval -- trusted, this file's own fixture
    found.push(eval(match[1]));
  }
  return found;
}

describe("Pidgin covers the web lifestyle tracker screens", () => {
  it("has a dictionary entry for every t(...) call in sleep/smoking/alcohol/activity/nutrition", () => {
    const missing: { file: string; strings: string[] }[] = [];
    for (const file of TRACKER_FILES) {
      const source = readFileSync(join(PATIENT_DIR, file), "utf8");
      const calls = stringsCalledWithT(source);
      const notCovered = calls.filter((s) => !hasPidgin(s));
      if (notCovered.length > 0) missing.push({ file, strings: notCovered });
    }
    expect(missing).toEqual([]);
  });

  it("is actually checking something", () => {
    // Guards against the scan above passing because the regex silently
    // matched nothing (e.g. a call-site style change from `t("x")` to
    // `t(\`x\`)`).
    let total = 0;
    for (const file of TRACKER_FILES) {
      const source = readFileSync(join(PATIENT_DIR, file), "utf8");
      total += stringsCalledWithT(source).length;
    }
    expect(total).toBeGreaterThan(60);
  });
});
