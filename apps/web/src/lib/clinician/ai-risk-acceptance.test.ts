import { aiRuntimeConfigSchema } from "@/lib/ai-governance/types";
import { daysUntil, maxValidUntil, restrictionStatusSchema, signAcceptanceSchema } from "./ai-risk-acceptance";

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

describe("runtime config restricted mode", () => {
  it("reads as unrestricted when the database does not send the key yet", () => {
    const parsed = aiRuntimeConfigSchema.parse(baseConfig);
    expect(parsed.restricted_mode).toBeUndefined();
    expect(parsed.restricted_mode === "advisory_only").toBe(false);
  });

  it("reads advisory_only and the date when sent, and refuses an unknown mode", () => {
    const parsed = aiRuntimeConfigSchema.parse({ ...baseConfig, restricted_mode: "advisory_only", reevaluation_due: "2026-11-26" });
    expect(parsed.restricted_mode).toBe("advisory_only");
    expect(parsed.reevaluation_due).toBe("2026-11-26");
    expect(aiRuntimeConfigSchema.safeParse({ ...baseConfig, restricted_mode: "off" }).success).toBe(false);
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

  it("limits an acceptance to 90 days", () => {
    expect(maxValidUntil(new Date("2026-10-27T00:00:00Z"))).toBe("2027-01-25");
  });

  it("needs a real summary and a date", () => {
    expect(signAcceptanceSchema.safeParse({ summary: "short", validUntil: "2026-12-01" }).success).toBe(false);
    expect(signAcceptanceSchema.safeParse({ summary: "Over-triage in two required suites is accepted as the safe direction.", validUntil: "2026-12-01" }).success).toBe(true);
    expect(signAcceptanceSchema.safeParse({ summary: "Over-triage in two required suites is accepted as the safe direction.", validUntil: "tomorrow" }).success).toBe(false);
  });

  it("parses the status the database returns", () => {
    const ok = restrictionStatusSchema.safeParse({
      system_code: "AI-001", name: "AI Health Coach", enabled: true, restricted_mode: "advisory_only", restricted_since: "2026-10-27T00:00:00Z",
      restriction_reason: "Restricted per D-08", reevaluation_due: "2026-11-26", disabled_reason: null, acceptance: null,
    });
    expect(ok.success).toBe(true);
  });
});
