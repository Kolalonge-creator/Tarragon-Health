import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_PATHWAYS } from "../protocols/index";
import { createInHouseEngine, IN_HOUSE_ENGINE_VERSION } from "./in-house-engine";
import { createSafeEngine, PathwayUnavailableError } from "./symptom-engine";
import { CONTRACT_DEFAULT_CONFIG, forbiddenModelOrNetworkUse, runSymptomEngineContract } from "./contract-suite";
import { EMPTY_CONTEXT } from "../safety/context-tightening";

runSymptomEngineContract({ name: "in-house deterministic engine", makeAdapter: () => createInHouseEngine({ pathways: SEED_PATHWAYS }) });

const SRC = join(fileURLToPath(new URL("..", import.meta.url)));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) return sources(full);
    return f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "contract-suite.ts" ? [full] : [];
  });
}

describe("in-house engine", () => {
  it("is the internal engine at a stated version", () => {
    const e = createInHouseEngine({ pathways: SEED_PATHWAYS });
    expect(e.engine).toBe("internal");
    expect(e.engineVersion).toBe(IN_HOUSE_ENGINE_VERSION);
  });

  it("walks a pathway question by question and finishes (adaptive: the answers decide the next question)", async () => {
    const safe = createSafeEngine(createInHouseEngine({ pathways: SEED_PATHWAYS }), CONTRACT_DEFAULT_CONFIG);
    const cap = { presentingComplaintKey: "headache", onset: "gradual" as const, severity: 3, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} };
    const s1 = await safe.start({ capture: cap, context: EMPTY_CONTEXT });
    expect(s1.kind).toBe("question");
    if (s1.kind !== "question") return;
    // "yes" and "no" to the same first question lead to different next steps
    const yes = await safe.answer(s1.session, s1.question.key, true);
    const no = await safe.answer(s1.session, s1.question.key, false);
    const keyOf = (s: typeof yes) => (s.kind === "question" ? s.question.key : `done:${s.result.safetyNetMessageKey}`);
    expect(keyOf(yes)).not.toBe(keyOf(no));
  });

  it("an unknown complaint is a protocol-unavailable escalation, never reassurance", async () => {
    const safe = createSafeEngine(createInHouseEngine({ pathways: [] }), CONTRACT_DEFAULT_CONFIG);
    const step = await safe.start({ capture: { presentingComplaintKey: "x", onset: "gradual", severity: 2, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} }, context: EMPTY_CONTEXT });
    expect(step.kind === "complete" && step.result.degradedReason).toBe("protocol_unavailable");
    expect(new PathwayUnavailableError().name).toBe("PathwayUnavailableError");
  });

  it("calls no language model and no network (INV-01): no source in the package names one", () => {
    const offenders = sources(SRC).flatMap((f) => forbiddenModelOrNetworkUse(readFileSync(f, "utf8")).map((o) => `${f.replace(SRC, "")}: ${o}`));
    expect(offenders).toEqual([]);
  });

  it("the source scanner ignores comments but still finds a name after an unterminated comment, and stays fast on repeated openers", () => {
    expect(forbiddenModelOrNetworkUse("/* openai is fine in a comment */ const a = 1;")).toEqual([]);
    expect(forbiddenModelOrNetworkUse("// fetch( in a line comment\nconst a = 1;")).toEqual([]);
    expect(forbiddenModelOrNetworkUse("const a = 1; // fetch( after code\nconst b = 2;")).toEqual([]);
    expect(forbiddenModelOrNetworkUse("const url = 'https://x.test'; fetch(url);")).toContain("fetch");
    expect(forbiddenModelOrNetworkUse("/* never closed\nconst r = fetch(url);")).toContain("fetch");
    const started = Date.now();
    forbiddenModelOrNetworkUse("/*".repeat(50_000) + "a/*".repeat(50_000));
    forbiddenModelOrNetworkUse("9//".repeat(100_000));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("dependant policy (a child is never reassured, and a clinician is asked to look)", () => {
  const cap = { presentingComplaintKey: "headache", onset: "gradual" as const, severity: 2, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} };
  const walk = async (ageYears: number | null, policy?: { max_age_years: number; minimum_category: "routine"; clinician_review_required: boolean }) => {
    const safe = createSafeEngine(createInHouseEngine({ pathways: SEED_PATHWAYS }), { ...CONTRACT_DEFAULT_CONFIG, dependantPolicy: policy });
    let step = await safe.start({ capture: cap, context: { ...EMPTY_CONTEXT, ageYears } });
    let n = 0;
    while (step.kind === "question" && n++ < 20) {
      const q = step.question;
      step = await safe.answer(step.session, q.key, q.kind === "boolean" ? false : q.options[0]!.value);
    }
    return step.kind === "complete" ? step.result : null;
  };

  it("raises self-care to routine with a review for a known child, and never touches an adult or an unknown age", async () => {
    const policy = { max_age_years: 17, minimum_category: "routine" as const, clinician_review_required: true };
    const adult = await walk(40);
    expect(adult?.category).toBe("self_management");
    const child = await walk(9, policy);
    expect(child?.category).toBe("routine");
    expect(child?.clinicianReviewRequired).toBe(true);
    expect(child?.raisedBy).toContain("dependant_policy");
    expect((await walk(40, policy))?.category).toBe("self_management");
    expect((await walk(null, policy))?.category).toBe("self_management");
  });
});
