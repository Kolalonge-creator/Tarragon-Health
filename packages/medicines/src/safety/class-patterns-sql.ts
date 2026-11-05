import { CLASS_PATTERNS } from "./drug-safety";

/**
 * T2-11b (HZ-RX-03): the database checks a prescription at signing with the SAME drug-class patterns the add-a-medicine check runs
 * here. The patterns are copied into `private.drug_class_patterns` by the migration `*_t2_11b_prescribing_safety_gaps.sql`;
 * `class-patterns-sql.test.ts` fails if that copy and this list ever differ, so the two engines cannot drift.
 *
 * JavaScript and Postgres regular expressions differ in one way that matters here: `\b` is a word boundary in JavaScript but a
 * backspace in a Postgres advanced regular expression, where the word boundary is `\y`. Every other construct the patterns use
 * (`\w`, groups, alternation, `[- ]?`, `?`) means the same in both.
 */
export interface SqlClassPattern {
  ordinal: number;
  cls: string;
  pattern: string;
}

export function toPostgresPattern(jsSource: string): string {
  return jsSource.replace(/\\b/g, "\\y");
}

export function classPatternsForSql(): SqlClassPattern[] {
  return CLASS_PATTERNS.map((p, index) => ({ ordinal: index + 1, cls: p.cls, pattern: toPostgresPattern(p.pattern.source) }));
}

/** The VALUES rows exactly as the migration writes them (one per line, single quotes doubled). */
export function classPatternValuesSql(): string {
  return classPatternsForSql()
    .map((p) => `  (${p.ordinal}, '${p.cls}', '${p.pattern.replace(/'/g, "''")}')`)
    .join(",\n");
}
