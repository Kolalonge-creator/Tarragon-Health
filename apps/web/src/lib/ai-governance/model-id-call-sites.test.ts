/**
 * The approved model for every AI system lives in configuration (`ai_system_versions.model_identifier`, read through
 * `ai_runtime_config().expected_model_identifier`). Until November 2026 most call sites ignored it and sent a model id written into the
 * code, so approving a new model version in the governance console changed nothing and a model change needed a code release.
 *
 * This test keeps it that way:
 *   1. no source file sets a request's `model:` or an audit row's `modelIdentifier:` straight to an in-code constant or a `"claude-…"`
 *      literal. It must be the governed id (or, in a low-level reader, `input.modelId ?? CONSTANT`, with the caller passing the id);
 *   2. every entry point below CALLS governedModelId, so the low-level readers are actually handed the governed id.
 *
 * Exceptions live in ALLOWED with the reason. Adding one is a decision, not a convenience.
 */
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB_SRC = join(__dirname, "../..");
const ROOT = join(WEB_SRC, "../../..");

/** A request or audit field set directly to an UPPER_CASE constant or a claude literal. */
const DIRECT = /\b(model|modelIdentifier):\s*("claude-[^"]*"|[A-Z][A-Z0-9_]*\b)/;

const ALLOWED: Record<string, string> = {
  "apps/web/src/lib/ai-governance/run-coach-eval-suites.ts":
    "Evaluation harness run from a developer shell; it pins the model it evaluates on purpose.",
  "apps/web/src/lib/ai-governance/run-scribe-documents-eval.ts":
    "Evaluation harness; pins the scribe model it evaluates on purpose.",
  "apps/web/src/lib/scribe/note-draft.ts":
    "Evaluation-only mirror of supabase/functions/scribe-draft (kept identical by scribe-draft-mirror.test.ts); production scribe calls run in the edge function, which cannot import this library.",
  "apps/web/src/lib/ai-coach/handoff-summary.ts":
    "Runs under AI-001 (the coach), whose approved model is the coach's own (claude-sonnet-5). The handoff summary deliberately uses a smaller model; following AI-001's approved version would silently move it to the coach's model. Needs its own registered system to be governed.",
  "apps/web/src/lib/ml/governed-ml-client.ts":
    "The Tarragon ML service, not a vendor model: its identifier is the service version, not a model choice.",
};

/** Files that hand a governed model id to the reader they call, or send it themselves. */
const ENTRY_POINTS = [
  "apps/web/src/app/api/mobile/cuff-display-proposal/route.ts",
  "apps/web/src/lib/appointment-prep/generate.ts",
  "apps/web/src/lib/care-messages/generate-draft-reply.ts",
  "apps/web/src/lib/case-briefs/generate.ts",
  "apps/web/src/lib/clinical-documents/classify-run.ts",
  "apps/web/src/lib/diary/read-diary-page.ts",
  "apps/web/src/lib/document-capture/run.ts",
  "apps/web/src/lib/ecg-reports/extraction-actions.ts",
  "apps/web/src/lib/health-report/ai-summary.ts",
  "apps/web/src/lib/imaging-reports/extraction-actions.ts",
  "apps/web/src/lib/lab-reports/extraction-actions.ts",
  "apps/web/src/lib/medications/pack-actions.ts",
  "apps/web/src/lib/patient-explainer/generate.ts",
  "apps/web/src/lib/service-navigation/generate.ts",
  "apps/web/src/lib/vaccination-cards/extraction-actions.ts",
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules" && name !== "__tests__") walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (full: string) => relative(ROOT, full).split("\\").join("/");

describe("governed model ids at every AI call site", () => {
  const files = walk(WEB_SRC);

  it("never sends or audits an in-code model constant directly", () => {
    const offenders: string[] = [];
    for (const full of files) {
      const path = rel(full);
      if (ALLOWED[path]) continue;
      stripComments(readFileSync(full, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (DIRECT.test(line)) offenders.push(`${path}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it.each(ENTRY_POINTS)("%s resolves the model with governedModelId", (path) => {
    expect(stripComments(readFileSync(join(ROOT, path), "utf8"))).toMatch(/\bgovernedModelId\s*\(/);
  });

  it("every allow-listed file still exists (stale entries are deleted, not left to excuse a new file)", () => {
    const missing = Object.keys(ALLOWED).filter((path) => !files.some((f) => rel(f) === path));
    expect(missing).toEqual([]);
  });
});
