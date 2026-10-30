/**
 * D.5 / D.10 and docs/audit-D4-D5-D10.md G-01: every place that talks to a model provider is registered, mapped to a system code in
 * `ai_systems`, and reaches the kill switch. The audit found AI-013, AI-014 and AI-015 running in production with no registry row at all
 * (September 2026) because nothing tied a new call site to the registry. This test is that tie.
 *
 * It walks the repository for any non-test file that names a model-provider host or SDK. A file that is not listed below FAILS the test:
 * adding a model call means adding a line here, naming its system code, and showing where the kill switch is checked.
 *
 * `gatedIn` names the file(s) that must CALL the governance layer (runGovernedAi, decideAiGovernance, or read ai_runtime_config; a
 * comment or a bare import does not count) for that call site. It is usually the file itself. For a low level extractor it is the action or route that calls
 * it, because the extractor is only ever reached through that entry point. A site with no gate is listed in KNOWN_UNGATED with the audit
 * item that tracks it; that list may only shrink (a test fails if a listed site has since gained a gate, so the entry gets deleted).
 */
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { AI_SYSTEMS } from "./system-codes";

const ROOT = join(__dirname, "../../../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".turbo", "coverage", ".expo", "ios", "android"]);
const SCAN_ROOTS = ["apps/web/src", "apps/web/scripts", "apps/mobile/src", "supabase/functions", "services", "packages"];

/** A model provider host, SDK or client, anywhere in a non-test source file. */
const MODEL_CALL =
  /@anthropic-ai\/sdk|@langchain\/anthropic|ChatAnthropic|new Anthropic\(|api\.anthropic\.com|api\.voyageai\.com|voyageai|api\.openai\.com|generativelanguage\.googleapis|api\.elevenlabs/;
/**
 * Evidence a file is inside the governance layer: it CALLS the governed runner or the decision function, or reads the runtime config.
 * Comments are removed first and a bare import does not count, because a comment such as "see ai-governance" or a type-only import
 * would otherwise satisfy the check while the model call still had no kill switch (code review, 2026-10-27).
 */
const GOVERNED = /\b(?:runGovernedAi|decideAiGovernance|embeddingCronSkip)\s*[<(]|ai_runtime_config/;
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
const isGoverned = (src: string) => GOVERNED.test(stripComments(src));

interface Site {
  /** Codes from `ai_systems` this file calls on behalf of. Empty only with `offline`. */
  systems: string[];
  /** Files that must mention the governance layer. Defaults to the file itself. */
  gatedIn?: string[];
  /** Not reachable from a patient or clinician request: evaluation or tooling that runs from a developer shell. */
  offline?: string;
}

const W = "apps/web/src/lib";
const CALL_SITES: Record<string, Site> = {
  [`${W}/ai-coach/graph.ts`]: { systems: ["AI-001", "AI-009", "AI-020"], gatedIn: [`${W}/ai-coach/index.ts`] },
  [`${W}/ai-coach/model.ts`]: { systems: ["AI-001"], gatedIn: [`${W}/ai-coach/index.ts`] },
  [`${W}/ai-coach/handoff-summary.ts`]: { systems: ["AI-001"] },
  [`${W}/appointment-prep/generate.ts`]: { systems: ["AI-013"] },
  [`${W}/care-messages/generate-draft-reply.ts`]: { systems: ["AI-014"] },
  [`${W}/case-briefs/generate.ts`]: { systems: ["AI-004"] },
  [`${W}/diary/read-diary-page.ts`]: { systems: ["AI-021"] },
  [`${W}/document-capture/extract.ts`]: { systems: ["AI-018"], gatedIn: [`${W}/document-capture/run.ts`] },
  [`${W}/ecg-reports/extract.ts`]: { systems: ["AI-006"], gatedIn: [`${W}/ecg-reports/extraction-actions.ts`] },
  [`${W}/health-report/ai-summary.ts`]: { systems: ["AI-019"] },
  [`${W}/imaging-reports/extract.ts`]: { systems: ["AI-016"], gatedIn: [`${W}/imaging-reports/extraction-actions.ts`] },
  [`${W}/lab-reports/extract.ts`]: { systems: ["AI-005"], gatedIn: [`${W}/lab-reports/extraction-actions.ts`] },
  [`${W}/lifestyle/coaching-proposer.ts`]: { systems: ["AI-002"] },
  [`${W}/lifestyle/voyage-embedder.ts`]: { systems: ["AI-009"], gatedIn: [`${W}/lifestyle/find-relevant-content.ts`] },
  [`${W}/medications/pack-vision.ts`]: { systems: ["AI-007"], gatedIn: [`${W}/medications/pack-actions.ts`] },
  [`${W}/nutrition/meal-plan-generate.ts`]: { systems: ["AI-011"], gatedIn: ["apps/web/src/app/(dashboard)/patient/nutrition-actions.ts"] },
  [`${W}/nutrition/meal-vision.ts`]: {
    systems: ["AI-008"],
    gatedIn: ["apps/web/src/app/(dashboard)/patient/nutrition-actions.ts", "apps/web/src/app/api/mobile/nutrition/meal-photo-estimate/route.ts"],
  },
  [`${W}/patient-explainer/generate.ts`]: { systems: ["AI-003"] },
  // A plain copy of the scribe's model call so the evaluation runners can exercise it (only run-scribe-*-eval imports it, checked by
  // grep). The live path is the edge function below, which reads ai_runtime_config; a mirror test keeps the two in step.
  [`${W}/scribe/note-draft.ts`]: { systems: ["AI-017"], gatedIn: ["supabase/functions/scribe-draft/index.ts"] },
  [`${W}/service-navigation/generate.ts`]: { systems: ["AI-015"] },
  [`${W}/vaccination-cards/extract.ts`]: { systems: ["AI-012"], gatedIn: [`${W}/vaccination-cards/extraction-actions.ts`] },
  [`${W}/vitals/cuff-display-vision.ts`]: { systems: ["AI-022"], gatedIn: ["apps/web/src/app/api/mobile/cuff-display-proposal/route.ts"] },
  "supabase/functions/scribe-draft/index.ts": { systems: ["AI-017"] },
  [`${W}/ai-governance/run-coach-eval-suites.ts`]: {
    systems: ["AI-001"],
    offline: "runs the coach evaluation suites for the CMO; calls the model to grade, never on a patient's behalf",
  },
  [`${W}/ai-governance/run-scribe-documents-eval.ts`]: {
    systems: ["AI-017"],
    offline: "runs the scribe document-draft evaluation suite for the CMO on synthetic facts; never on a patient's behalf",
  },
  "apps/web/scripts/ai-coach-safety-eval.ts": { systems: ["AI-001"], offline: "developer-run safety evaluation script" },
  "apps/web/scripts/lib/scope-guardrail-judge.ts": { systems: [], offline: "developer-run judge for the scope-guardrail evaluations" },
};

/**
 * Call sites with no governance reference at all today. Each is tracked by an audit item. This list may only shrink.
 * (Empty entries are deleted, not kept.)
 */
const KNOWN_UNGATED: Record<string, string> = {};

function walk(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.(test|spec)\.|\.d\.ts$/.test(name) && !full.includes("__tests__")) out.push(full);
  }
}

function modelCallFiles(): string[] {
  const all: string[] = [];
  for (const r of SCAN_ROOTS) walk(join(ROOT, r), all);
  return all
    .filter((f) => MODEL_CALL.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f))
    .sort();
}

const registeredCodes = new Set<string>(Object.values(AI_SYSTEMS).map((s) => s.code));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("AI call sites (D.5, audit G-01)", () => {
  const found = modelCallFiles();

  it("finds the call sites at all (a broken walker must not pass vacuously)", () => {
    expect(found.length).toBeGreaterThanOrEqual(20);
  });

  it("every file that talks to a model provider is listed here, so a new one must be registered on purpose", () => {
    const unlisted = found.filter((f) => !(f in CALL_SITES));
    expect(unlisted).toEqual([]);
  });

  it("every listed file still talks to a model provider (a deleted or renamed site must be removed from the list)", () => {
    const stale = Object.keys(CALL_SITES).filter((f) => !found.includes(f));
    expect(stale).toEqual([]);
  });

  it("every system code named here exists in the registry mirror (AI_SYSTEMS), so none is invented", () => {
    const unknown = Object.entries(CALL_SITES).flatMap(([file, s]) => s.systems.filter((c) => !registeredCodes.has(c)).map((c) => `${file}: ${c}`));
    expect(unknown).toEqual([]);
  });

  it("the system a file names in its own code (AI_SYSTEMS.<key>) is one of the systems listed for it", () => {
    const byKey = new Map<string, string>(Object.entries(AI_SYSTEMS).map(([k, s]) => [k, s.code]));
    const wrong: string[] = [];
    for (const [file, site] of Object.entries(CALL_SITES)) {
      for (const m of read(file).matchAll(/AI_SYSTEMS\.([A-Za-z]+)\.code/g)) {
        const code = byKey.get(m[1]);
        if (code && !site.systems.includes(code)) wrong.push(`${file} uses ${code} but lists ${site.systems.join(",") || "nothing"}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every site is either offline tooling with a stated reason, or names at least one registered system", () => {
    const bad = Object.entries(CALL_SITES).filter(([, s]) => (s.offline ? s.offline.trim().length < 15 : s.systems.length === 0));
    expect(bad.map(([f]) => f)).toEqual([]);
  });

  it("every live site reaches the governance layer (kill switch) in its own file or the named entry point", () => {
    const ungated: string[] = [];
    for (const [file, site] of Object.entries(CALL_SITES)) {
      if (site.offline) continue;
      const gates = site.gatedIn ?? [file];
      const ok = gates.every((g) => isGoverned(read(g)));
      if (!ok && !(file in KNOWN_UNGATED)) ungated.push(file);
    }
    expect(ungated).toEqual([]);
  });

  it("a site listed as known-ungated has not since gained a gate (then the entry must be deleted)", () => {
    const healed = Object.keys(KNOWN_UNGATED).filter((file) => {
      const site = CALL_SITES[file];
      return site && !site.offline && (site.gatedIn ?? [file]).every((g) => isGoverned(read(g)));
    });
    expect(healed).toEqual([]);
  });

  it("a comment or a bare import is not governance, but a real call is", () => {
    expect(isGoverned('// see ai-governance for the kill switch\nimport type { X } from "@/lib/ai-governance";')).toBe(false);
    expect(isGoverned('/* runGovernedAi( is used elsewhere */ const x = 1;')).toBe(false);
    expect(isGoverned("const r = await runGovernedAi<Out>({ systemCode })")).toBe(true);
    expect(isGoverned("const d = await decideAiGovernance(supabase, code);")).toBe(true);
    expect(isGoverned('await supabase.rpc("ai_runtime_config", { p_system_code: "AI-017" })')).toBe(true);
  });

  it("SABOTAGE: an unlisted file with a provider call is caught by the same check", () => {
    const fake = "apps/web/src/lib/not-registered/new-model-call.ts";
    const withFake = [...found, fake];
    expect(withFake.filter((f) => !(f in CALL_SITES))).toEqual([fake]);
    // And the host pattern really matches the shapes that mattered in September: a bare fetch to the provider.
    expect(MODEL_CALL.test('await fetch("https://api.anthropic.com/v1/messages")')).toBe(true);
    expect(MODEL_CALL.test('await fetch("https://api.voyageai.com/v1/embeddings")')).toBe(true);
    expect(MODEL_CALL.test("const x = 1")).toBe(false);
  });
});
