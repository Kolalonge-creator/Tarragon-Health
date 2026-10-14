import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Plan item R2, point 3: a new triage band must live in a RULE SET (versioned, signed by the CMO, shared by phone and server), never
 * in app code. This test scans the TypeScript of the apps, the packages and the edge functions for glucose and blood pressure
 * threshold comparisons and threshold tables, and FAILS when one appears in a file that is not on the explicit allowlist below, or when an
 * allowlisted file gains a hit. The allowlist is a ratchet: it records the legacy files that still carry their own numbers (the CMO's
 * Q1 decision keeps the older pipelines running until parity is shown), the exact count in each, and why. A file that loses a hit must
 * lower its number here, so the list can only shrink.
 *
 * To put a number in app code legitimately (a typo gate, a display colour, a risk score that is not triage) add `// band-ok: <reason>` on
 * the same line. Anything that decides what a patient is told to do about a reading belongs in a rule set instead.
 */
const root = new URL("../../../", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".next", ".turbo", "ios", "android", "dist", "build", "coverage", ".expo", "docs", "build-reports", ".git", "migrations", "store-assets", "assets"]);
const SCAN_ROOTS = ["apps", "packages", "supabase/functions"];

const GLUCOSE_COMPARE = /\b\w*(glucose|mmol|ketone)\w*\s*(<=|>=|<|>)\s*\d+(\.\d+)?|\b\d+(\.\d+)?\s*(<=|>=|<|>)\s*\w*(glucose|mmol|ketone)\w*/i;
const GLUCOSE_TABLE = /\b(severeHypo|hypoAlert|highForDka|veryHigh|persistentHigh|ketone\w*|glucose\w*|hypo\w*|hyper\w*|mmol\w*)\s*:\s*\d+(\.\d+)?\s*[,}]/i;
const BP_COMPARE = /\b(systolic|diastolic|sbp|dbp)\w*\s*(<=|>=|<|>)\s*\d{2,3}\b|\b\d{2,3}\s*(<=|>=|<|>)\s*\w*(systolic|diastolic)/i;
const BP_TABLE = /\b(systolic|diastolic|sbp|dbp|\w*Systolic|\w*Diastolic)\w*\s*:\s*\d{2,3}\s*[,}]/i;

/** The lines of a source text that carry a glucose or blood pressure threshold. Comments and `band-ok` lines are not counted. */
export function bandLines(source: string): number[] {
  const hits: number[] = [];
  source.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || line.includes("band-ok:")) return;
    if (GLUCOSE_COMPARE.test(line) || GLUCOSE_TABLE.test(line) || BP_COMPARE.test(line) || BP_TABLE.test(line)) hits.push(i + 1);
  });
  return hits;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry) && !/\.(test|spec)\./.test(entry) && !/\.d\.ts$/.test(entry)) out.push(p);
  }
}

/** Rule sets are where bands belong. */
const RULE_SET_DIRS = ["packages/clinical/src/rules/"];

/**
 * Legacy and non-triage files that carry numbers today. `count` is exact. Each reason says why the number is not a triage band, or which
 * older pipeline it belongs to and what retires it.
 */
export const LEGACY_ALLOWLIST: Record<string, { count: number; reason: string }> = {
  "apps/mobile/src/lib/bp-classification.ts": { count: 3, reason: "Legacy on-device BP bands (synced thresholds). Runs beside bp_care_triage until parity is shown (CMO Q1); retired with the legacy BP triggers." },
  "apps/web/src/lib/rules/bp-classification.ts": { count: 3, reason: "Legacy server BP bands, the web twin of the file above. Same retirement (CMO Q1)." },
  "apps/mobile/src/lib/glucose-red-flags.ts": { count: 7, reason: "Legacy on-device glucose bands. Runs beside glucose_care_triage until parity is shown (Q1 applied to glucose); retired with the SQL glucose backstop." },
  "apps/web/src/lib/vitals/glucose-red-flags.ts": { count: 7, reason: "Legacy server glucose bands, the web twin of the file above. Same retirement." },
  "apps/web/src/lib/cds/engine.ts": { count: 3, reason: "Clinical decision support BP bands (200/120, 160/100, 135/85) used by the clinician console. A third BP list that can disagree with the engine; follow-up in the R2 closeout to move it onto bp_care_triage." },
  "apps/web/src/lib/vitals/plausibility.ts": { count: 4, reason: "Plausibility gates for typed values (is this number humanly possible), not clinical bands." },
  "apps/web/src/lib/testing-days/model.ts": { count: 1, reason: "Plausibility gate for a point-of-care BP entry at a testing day, not a band." },
  "apps/mobile/src/lib/triage-device.ts": { count: 1, reason: "FALLBACK_TARGET: the standard home target used only when the phone has no cached personal target. A target, not a band; the bands read it." },
  "apps/web/src/lib/rules/cvd-risk-afro.ts": { count: 4, reason: "Cardiovascular risk score points (AFRO-style), a risk calculation, not triage." },
  "apps/web/scripts/eval-ai004-case-brief.ts": { count: 3, reason: "Fixture data for an AI evaluation script, not a band." },
  "apps/web/src/app/(dashboard)/admin/settings/vitals-reminders/rules-manager.tsx": { count: 1, reason: "Default reminder days, not a band." },
  "apps/mobile/src/lib/healthkit.ts": { count: 1, reason: "A unit string for HealthKit (mmol per litre), not a band." },
  "packages/shared/src/proposed-config/registry.ts": { count: 11, reason: "Versioned PROPOSED config values (home BP targets, trend gaps, and the S67 pregnancy BP lines that mirror bp_care_triage v5); governed by the registry and its CMO confirmation, not hard-coded logic." },
  "packages/lifestyle-engine/src/adapters/diabetes.ts": { count: 1, reason: "SEVERE_HYPO_MMOL in the lifestyle safety adapter (spec 8.2): a stop-the-plan guard, not patient triage. Follow-up: read it from glucose_care_triage params." },
};

describe("no glucose or blood pressure band outside a rule set", () => {
  const files: string[] = [];
  for (const r of SCAN_ROOTS) walk(join(root, r), files);
  const found = new Map<string, number[]>();
  for (const f of files) {
    const rel = relative(root, f).split(sep).join("/");
    if (RULE_SET_DIRS.some((d) => rel.startsWith(d))) continue;
    const hits = bandLines(readFileSync(f, "utf8"));
    if (hits.length > 0) found.set(rel, hits);
  }

  it("scans a real number of files", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("finds no band in a file that is not on the allowlist (put it in a rule set, or add `// band-ok: reason` with a reason)", () => {
    const unexpected = [...found].filter(([f]) => !(f in LEGACY_ALLOWLIST)).map(([f, lines]) => `${f}: lines ${lines.join(", ")}`);
    expect(unexpected).toEqual([]);
  });

  it("an allowlisted file may not gain a band, and the allowlist must shrink when a file loses one (exact counts)", () => {
    const drift = Object.entries(LEGACY_ALLOWLIST)
      .filter(([f, e]) => (found.get(f)?.length ?? 0) !== e.count)
      .map(([f, e]) => `${f}: allowlist says ${e.count}, found ${found.get(f)?.length ?? 0}`);
    expect(drift).toEqual([]);
  });

  it("every allowlist entry says why", () => {
    for (const [f, e] of Object.entries(LEGACY_ALLOWLIST)) expect([f, e.reason.length > 20]).toEqual([f, true]);
  });

  it("the rule set files are exempt: the bands live there", () => {
    expect(RULE_SET_DIRS).toEqual(["packages/clinical/src/rules/"]);
    expect(bandLines(readFileSync(join(root, "packages/clinical/src/rules/glucose-care-v1.ts"), "utf8")).length).toBeGreaterThan(0);
  });

  it("the scanner itself catches what it is for (sabotage check)", () => {
    expect(bandLines("if (glucose < 3.0) alert();")).toEqual([1]);
    expect(bandLines("if (mmol >= 11) x();")).toEqual([1]);
    expect(bandLines("  veryHigh: 20.0,")).toEqual([1]);
    expect(bandLines("if (systolic >= 180) urgent();")).toEqual([1]);
    expect(bandLines("if (140 <= systolic) x();")).toEqual([1]);
    expect(bandLines("  emergencySystolic: 180,")).toEqual([1]);
    expect(bandLines("// glucose < 3.0 is severe")).toEqual([]);
    expect(bandLines(" * systolic >= 180")).toEqual([]);
    expect(bandLines("if (glucose < 3.0) x(); // band-ok: typo gate")).toEqual([]);
    expect(bandLines("const n = list.length > 0;")).toEqual([]);
  });
});
