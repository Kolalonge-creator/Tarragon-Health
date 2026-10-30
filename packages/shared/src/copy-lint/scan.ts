import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Copy-lint for user-facing strings (v5 spec Section 0 rule 9, CLAUDE.md v5 rule 4).
 *
 * Banned in user-facing copy: the words "cure", "instant doctor", "free
 * healthcare", the phrase "your doctor" (say "your care team"), and em dashes.
 * The voice rules in docs/design/COPY-VOICE.md that a line scan can check are
 * enforced too: no "BP", "escalate" or "care gap" in patient-facing text, and
 * no "Mum" or "Let's" anywhere. The rest of that guide (complete sentences,
 * saying why) needs a reader, so a person still checks it before a PR.
 *
 * This is a line heuristic, not a parser: it skips comment lines, tests and
 * generated files, then flags a banned term on any remaining line. It can
 * over-report (for example a code identifier), which is why it starts in
 * WARN-ONLY mode. `copyLintMode()` flips to "enforce" when COPY_LINT_ENFORCE=1.
 */
export interface CopyRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly reason: string;
  /** When set, the rule applies only to files whose repo-relative path matches. */
  readonly scope?: RegExp;
}

/**
 * Code only a patient or a visitor reads: the marketing site, the patient dashboard and the patient screens of the mobile app.
 * Staff screens (clinician, admin, analytics) are left out on purpose, because their readers use "BP", "escalate" and
 * "care gap" as working vocabulary. packages/i18n, packages/notifications and the notification templates are left out because
 * each mixes patient and staff messages.
 */
export const PATIENT_FACING = /^(apps\/web\/src\/app\/(\(marketing\)|\(dashboard\)\/patient)\/|apps\/mobile\/src\/(screens\/(?!clinician)|components\/|ui\/))/;

// Text a person can read: one whole string literal, or JSX text. A bare identifier, an import path or a code value never matches.
const inText = (word: string): RegExp =>
  new RegExp(`(["'\`])(?:(?!\\1)[^\\\\\\n])*${word}(?:(?!\\1)[^\\\\\\n])*\\1|>[^<>{}\\n]*${word}[^<>{}\\n]*<`);

export const COPY_RULES: readonly CopyRule[] = [
  { id: "cure", pattern: /\bcure[sd]?\b/i, reason: 'never claim a cure' },
  { id: "instant-doctor", pattern: /instant doctor/i, reason: 'implies an immediate doctor; say "your care team"' },
  { id: "free-healthcare", pattern: /free health ?care/i, reason: "overpromises; patients pay for a clinician's time" },
  { id: "your-doctor", pattern: /\byour doctor\b/i, reason: 'care is delivered by a team; say "your care team"' },
  { id: "em-dash", pattern: /—/, reason: "no em dashes in user-facing copy" },
  // Only an en dash a person can read: inside a string literal or in JSX text. A legitimate numeric range carries a trailing
  // `// copy-lint-allow en-dash: <reason>` comment (see ALLOW_MARKER).
  { id: "en-dash", pattern: /(["'`])[^"'`\n]*–|>[^<>{}\n]*–[^<>{}\n]*</, reason: 'no en dashes in user-facing copy; write "9 to 14" or use a colon or full stop' },
  { id: "abbreviation-bp", pattern: inText("\\bBP\\b"), scope: PATIENT_FACING, reason: 'write "blood pressure", not "BP" (COPY-VOICE rule 2)' },
  { id: "internal-term", pattern: inText("\\b(?:escalat(?:e|es|ed|ion)|care gaps?)\\b"), scope: PATIENT_FACING, reason: 'internal words; say "referral to a doctor", "doctor review" or name the task (COPY-VOICE rule 4)' },
  { id: "colloquial", pattern: inText("\\b(?:Mum|Mummy|Let(?:'|\u2019)s)\\b"), reason: 'chatty register; warm means respectful, not casual (COPY-VOICE rule 6)' },
];

export interface CopyViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

export type CopyLintMode = "warn" | "enforce";
export const copyLintMode = (): CopyLintMode => (process.env.COPY_LINT_ENFORCE === "1" ? "enforce" : "warn");

/** A trailing `// copy-lint-allow en-dash: <reason>` exempts that line from the en-dash rule only (for example a real numeric range). */
export const ALLOW_MARKER = /\/\/\s*copy-lint-allow en-dash\b/;

const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/;
// An import path is code, not copy: "@/lib/sleep/escalate" must not count as the word "escalate".
const IMPORT_LINE = /^\s*(import\s+[\w*{"']|export\s+(\*|\{[^}]*\})\s*(as\s+\w+\s*)?from\s)/;

export function scanText(file: string, content: string): CopyViolation[] {
  const out: CopyViolation[] = [];
  const lines = content.split("\n");
  lines.forEach((text, i) => {
    if (COMMENT_LINE.test(text) || IMPORT_LINE.test(text)) return;
    // Drop a trailing line comment so prose after `//` is not flagged.
    const code = text.replace(/\s\/\/\s.*$/, "");
    for (const rule of COPY_RULES) {
      if (rule.scope && !rule.scope.test(file)) continue;
      if (rule.id === "en-dash" && ALLOW_MARKER.test(text)) continue;
      if (rule.pattern.test(code)) out.push({ file, line: i + 1, rule: rule.id, text: text.trim().slice(0, 160) });
    }
  });
  return out;
}

const SKIP_DIRS = new Set([
  "node_modules", ".next", "ios", "android", "dist", "build", ".turbo",
  "e2e", "e2e-browser", "__tests__", "__mocks__", "fixtures", "lab-corpus",
]);
const isSource = (name: string) =>
  /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts") && name !== "database.types.ts";

function* walk(dir: string): Generator<string> {
  // A missing root must fail loudly: swallowing it would let the lint pass while scanning nothing.
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (isSource(name)) yield p;
  }
}

/** Scan the user-facing source roots. Paths in results are relative to `repoRoot`. */
export function countSourceFiles(repoRoot: string, roots: readonly string[] = DEFAULT_ROOTS): number {
  let n = 0;
  for (const r of roots) for (const _ of walk(join(repoRoot, r))) n++;
  return n;
}

// W-59: the deployed email/push/in-app templates (edge function) are user-facing copy too, so they are in scope.
export const DEFAULT_ROOTS = [
  "apps/web/src",
  "apps/mobile/src",
  "packages/notifications/src",
  "packages/i18n/src",
  "supabase/functions/send-pending-notifications",
] as const;

export function scanRepo(repoRoot: string, roots: readonly string[] = DEFAULT_ROOTS): CopyViolation[] {
  const out: CopyViolation[] = [];
  for (const r of roots) {
    for (const file of walk(join(repoRoot, r))) {
      out.push(...scanText(relative(repoRoot, file), readFileSync(file, "utf8")));
    }
  }
  return out;
}

export function summarise(violations: readonly CopyViolation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of violations) counts[v.rule] = (counts[v.rule] ?? 0) + 1;
  return counts;
}
