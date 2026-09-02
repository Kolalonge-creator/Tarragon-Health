/**
 * The registry codes the running code uses to identify itself to AI
 * governance (Module 40.1), plus the one piece of governance policy that
 * has to exist in the code rather than in the database.
 *
 * WHY A STATIC MIRROR EXISTS AT ALL. Everything else about a registered AI
 * system — whether it is switched on, its guardrails, its governed prompt —
 * is read from `public.ai_runtime_config()` at call time, because that is
 * what makes the kill switch (40.17) real. But there is one question the
 * registry cannot answer: what should happen when the registry itself is
 * unreachable? Asking the database is not an option in exactly the moment
 * the database is not answering, so `failClosedIfGovernanceUnavailable` is
 * decided here, once, per system.
 *
 * The rule behind each value: a system whose wrong answer could influence a
 * clinical decision fails CLOSED (governance unreachable -> run the non-AI
 * fallback), because the fallback is a real, working path in every case —
 * see each system's `fallback_behaviour` in the registry. A system whose
 * wrong answer is a cosmetic inconvenience fails OPEN, because turning off
 * meal-photo estimation over a transient database blip would be a worse
 * trade than running it ungoverned for a minute.
 *
 * The rule: every system at risk_class `high` or `very_high` fails closed.
 * AI-003 is the one entry stricter than that: it is only moderate risk, but
 * it renders clinical content straight to a patient, and its fallback (the
 * result shown without a plain-language explanation) costs nothing.
 *
 * packages/db/tests/ai_governance.sql case 8 asserts the direction that
 * matters -- that no high or very-high risk system has drifted to fail-open
 * here. Being stricter than the rule is never the drift worth catching.
 */
export const AI_SYSTEMS = {
  coach: {
    code: "AI-001",
    failClosedIfGovernanceUnavailable: true,
  },
  lifestyleNudgeProposer: {
    code: "AI-002",
    failClosedIfGovernanceUnavailable: false,
  },
  patientResultExplainer: {
    code: "AI-003",
    failClosedIfGovernanceUnavailable: true,
  },
  caseBrief: {
    code: "AI-004",
    failClosedIfGovernanceUnavailable: true,
  },
  labReportExtraction: {
    code: "AI-005",
    failClosedIfGovernanceUnavailable: true,
  },
  ecgReportExtraction: {
    code: "AI-006",
    failClosedIfGovernanceUnavailable: true,
  },
  medicationPackVision: {
    code: "AI-007",
    failClosedIfGovernanceUnavailable: false,
  },
  mealPhotoNutrition: {
    code: "AI-008",
    failClosedIfGovernanceUnavailable: false,
  },
  lifestyleEmbeddings: {
    code: "AI-009",
    failClosedIfGovernanceUnavailable: false,
  },
  clinicalRiskScoring: {
    code: "AI-010",
    failClosedIfGovernanceUnavailable: true,
  },
} as const;

export type AiSystemKey = keyof typeof AI_SYSTEMS;
export type AiSystemCode = (typeof AI_SYSTEMS)[AiSystemKey]["code"];

const BY_CODE: ReadonlyMap<string, { code: AiSystemCode; failClosedIfGovernanceUnavailable: boolean }> =
  new Map(Object.values(AI_SYSTEMS).map((s) => [s.code, s]));

/**
 * The fail-closed policy for one system code. An unknown code fails closed:
 * a call site that has not been registered is a wiring gap, and the safe
 * reading of "governance has never heard of this" is not "carry on".
 */
export function failsClosedWhenGovernanceUnavailable(code: string): boolean {
  return BY_CODE.get(code)?.failClosedIfGovernanceUnavailable ?? true;
}
