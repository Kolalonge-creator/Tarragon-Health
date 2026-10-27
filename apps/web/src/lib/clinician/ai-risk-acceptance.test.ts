import { readFileSync } from "node:fs";
import { join } from "node:path";
import { aiRuntimeConfigSchema } from "@/lib/ai-governance/types";
import {
  MAX_ACCEPTANCE_DAYS,
  MAX_ACCEPTANCE_DAYS_NO_RERUN,
  daysUntil,
  explainSignError,
  maxValidUntil,
  restrictionStatusSchema,
  signAcceptanceSchema,
} from "./ai-risk-acceptance";

const migration = readFileSync(join(__dirname, "../../../../../supabase/migrations/20261027194803_w10_ai_restricted_advisory_mode.sql"), "utf8");

const baseConfig = {
  registered: true,
  system_code: "AI-001",
  system_id: "s1",
  name: "AI Health Coach",
  enabled: true,
  runtime_governed: true,
  lifecycle_status: "live",
  risk_class: "high",
  autonomy_level: "assist",
  clinically_meaningful: true,
  fallback_behaviour: "x",
  disabled_reason: null,
  expected_model_identifier: null,
  prompt: null,
  guardrails: [],
  knowledge_sources: [],
};
const runId = "11111111-1111-4111-8111-111111111111";

describe("runtime config restricted mode (fail closed)", () => {
  it("defaults to advisory_only when the key is missing, so drift reads as the cautious state", () => {
    expect(aiRuntimeConfigSchema.parse(baseConfig).restricted_mode).toBe("advisory_only");
  });

  it("reads none only when the database says none, and refuses an unknown mode", () => {
    expect(aiRuntimeConfigSchema.parse({ ...baseConfig, restricted_mode: "none" }).restricted_mode).toBe("none");
    expect(aiRuntimeConfigSchema.safeParse({ ...baseConfig, restricted_mode: "off" }).success).toBe(false);
  });
});

describe("one acceptance cap", () => {
  it("is the same number in the migration constants, the app constants and the error text", () => {
    expect(new RegExp(String.raw`ai_acceptance_max_days\(\) returns integer language sql immutable as \$\$ select ${MAX_ACCEPTANCE_DAYS} \$\$`).test(migration)).toBe(true);
    expect(new RegExp(String.raw`ai_acceptance_no_rerun_days\(\) returns integer language sql immutable as \$\$ select ${MAX_ACCEPTANCE_DAYS_NO_RERUN} \$\$`).test(migration)).toBe(true);
    expect(migration).toContain("accepted_at::date + private.ai_acceptance_max_days()");
    expect(explainSignError("acceptance_too_long: an acceptance can last at most 90 days")).toContain(String(MAX_ACCEPTANCE_DAYS));
    expect(explainSignError("acceptance_too_long_without_rerun: x")).toContain(String(MAX_ACCEPTANCE_DAYS_NO_RERUN));
  });

  it("limits the form date by whether a re-run exists", () => {
    const now = new Date("2026-10-27T00:00:00Z");
    expect(maxValidUntil(now, true)).toBe("2027-01-25");
    expect(maxValidUntil(now, false)).toBe("2026-11-26");
  });

  it("shows the database's real reason, not one generic message", () => {
    expect(explainSignError("acceptance_date_not_future: x")).toContain("after today");
    expect(explainSignError("acceptance_needs_rerun_link: x")).toContain("re-evaluation run");
    expect(explainSignError("acceptance_run_not_found: x")).toContain("completed evaluation run");
    expect(explainSignError("only the Chief Medical Officer can sign a risk acceptance")).toContain("Chief Medical Officer");
    expect(explainSignError("something odd")).toContain("could not be signed");
  });
});

describe("risk acceptance helpers", () => {
  it("counts whole days to the dated switch-off", () => {
    const now = new Date("2026-10-27T15:00:00Z");
    expect(daysUntil("2026-11-26", now)).toBe(30);
    expect(daysUntil("2026-10-27", now)).toBe(0);
    expect(daysUntil("2026-10-20", now)).toBe(-7);
    expect(daysUntil(null, now)).toBeNull();
  });

  it("needs a real summary, a date, and exactly one of a run or 'none re-run yet'", () => {
    const summary = "Over-triage in two required suites is accepted as the safe direction.";
    expect(signAcceptanceSchema.safeParse({ summary: "short", validUntil: "2026-12-01", evaluationRunId: null, noRerunYet: true }).success).toBe(false);
    expect(signAcceptanceSchema.safeParse({ summary, validUntil: "tomorrow", evaluationRunId: null, noRerunYet: true }).success).toBe(false);
    expect(signAcceptanceSchema.safeParse({ summary, validUntil: "2026-12-01", evaluationRunId: null, noRerunYet: true }).success).toBe(true);
    expect(signAcceptanceSchema.safeParse({ summary, validUntil: "2026-12-01", evaluationRunId: runId, noRerunYet: false }).success).toBe(true);
    expect(signAcceptanceSchema.safeParse({ summary, validUntil: "2026-12-01", evaluationRunId: runId, noRerunYet: true }).success).toBe(false);
    expect(signAcceptanceSchema.safeParse({ summary, validUntil: "2026-12-01", evaluationRunId: null, noRerunYet: false }).success).toBe(false);
  });

  it("parses the status the database returns", () => {
    const ok = restrictionStatusSchema.safeParse({
      system_code: "AI-001", name: "AI Health Coach", enabled: true, restricted_mode: "advisory_only", restricted_since: "2026-10-27T00:00:00Z",
      restriction_reason: "Restricted per D-08", reevaluation_due: "2026-11-26", restriction_resets: 1, disabled_reason: null,
      switch_off_on: "2026-11-26", days_until_switch_off: 30, latest_evaluation_completed_at: null, reevaluation_overdue: false, can_sign: true,
      max_acceptance_days: 90, no_rerun_acceptance_days: 30, acceptance: null,
    });
    expect(ok.success).toBe(true);
  });
});
