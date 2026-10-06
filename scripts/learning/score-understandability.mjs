#!/usr/bin/env node
/**
 * Scores an understandability test (docs/research/s33-understandability/README.md).
 *
 *   node scripts/learning/score-understandability.mjs <session-sheet.csv> [--min-n 10 --min-recall 0.8 --max-unsafe 0]
 *
 * The rule defaults below are the PROPOSED `learning.understandability_pass_rule` (owner CMO; a test in @tarragon/shared checks
 * these defaults equal the registry). Exit code 1 if any lesson fails, 2 if any has too few participants, 0 if all pass.
 * Needs Node 22.18 or later (it loads the TypeScript scorer directly).
 */
import { readFileSync } from "node:fs";
import { parseSessionCsv, scoreLessons } from "../../packages/i18n/src/understandability.ts";

const args = process.argv.slice(2);
const OPTIONS = new Set(["min-n", "min-recall", "max-unsafe"]);
// The sheet is the first argument that is neither an option nor an option's value (so a file name may start with a digit).
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && OPTIONS.has(args[i - 1].replace(/^--/, ""))));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
if (!file) {
  console.error("usage: score-understandability.mjs <session-sheet.csv> [--min-n N --min-recall R --max-unsafe N]");
  process.exit(64);
}
const rule = { minParticipants: opt("min-n", 10), minRecall: opt("min-recall", 0.8), maxUnsafe: opt("max-unsafe", 0) };
const scores = scoreLessons(parseSessionCsv(readFileSync(file, "utf8")), rule);
if (scores.length === 0) {
  console.error("no sessions found in the sheet");
  process.exit(64);
}
for (const s of scores) {
  const pct = (n) => (s.participants ? `${Math.round((n / s.participants) * 100)}%` : "-");
  console.log(
    `${s.lesson.padEnd(8)} ${s.language.padEnd(4)} n=${String(s.participants).padEnd(3)} message ${pct(s.recalledMessage).padEnd(5)} action ${pct(s.namedAction).padEnd(5)} both ${pct(s.both).padEnd(5)} unsafe ${s.unsafe}  read-aloud ${s.interviewerRead}  => ${s.verdict.toUpperCase()}${s.reasons.length ? `  (${s.reasons.join("; ")})` : ""}`,
  );
}
process.exit(scores.some((s) => s.verdict === "fail") ? 1 : scores.some((s) => s.verdict === "too_few") ? 2 : 0);
