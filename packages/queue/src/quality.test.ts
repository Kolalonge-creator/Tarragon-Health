import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditReason, lagosAuditMonth, scoreAudit, tier1ReadyForReview, type AuditForm, type AuditOutcomeRules } from "../../../supabase/functions/_shared/queue/quality";

const HERE = fileURLToPath(new URL(".", import.meta.url));
interface Case {
  name: string;
  safety: Record<string, unknown>;
  quality: Record<string, unknown>;
  rationale: string;
  expect: { outcome?: string; score?: number; critical?: boolean; error?: string };
}
const fixture = JSON.parse(readFileSync(join(HERE, "..", "fixtures", "audit-scoring-cases.json"), "utf8")) as {
  form: AuditForm;
  rules: AuditOutcomeRules;
  cases: Case[];
};

describe("scoreAudit (shared cases, also run through the database in s20_quality_and_safety.sql)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const r = scoreAudit(fixture.form, fixture.rules, c.safety, c.quality, c.rationale);
      if (c.expect.error) {
        expect(r).toEqual({ ok: false, error: c.expect.error });
      } else {
        expect(r).toEqual({ ok: true, score: { totalScore: c.expect.score, criticalMiss: c.expect.critical, outcome: c.expect.outcome } });
      }
    });
  }

  it("a missing rationale is treated as empty", () => {
    const r = scoreAudit(fixture.form, fixture.rules, { s1: true, s2: true }, { q1: 0, q2: 0, q3: 0, q4: 0 }, null);
    expect(r).toEqual({ ok: false, error: "rationale_too_short" });
  });

  it("the database proof embeds the same cases (a drift here means the two disagree)", () => {
    const proof = readFileSync(join(HERE, "..", "..", "db", "tests", "s20_quality_and_safety.sql"), "utf8");
    const match = /audit-cases-begin[\s\S]*?\$cases\$([\s\S]*?)\$cases\$/.exec(proof);
    if (!match?.[1]) throw new Error("audit cases not found in the proof");
    expect(JSON.parse(match[1])).toEqual(fixture);
  });
});

describe("auditReason", () => {
  const base = { priorityClassOriginal: 4, taskType: "amber_bp_review", level: 2 as const, tier1Audited: 0, tier1Target: 20, draw: 50 };
  it("audits every red event, by class or by type", () => {
    expect(auditReason({ ...base, priorityClassOriginal: 1 }, 10)).toBe("red_event");
    expect(auditReason({ ...base, taskType: "red_event_unacknowledged" }, 10)).toBe("red_event");
  });
  it("audits every titration", () => expect(auditReason({ ...base, taskType: "titration_signoff" }, 10)).toBe("titration"));
  it("audits every task of a level 1 clinician until the count is met", () => {
    expect(auditReason({ ...base, level: 1, tier1Audited: 19 }, 10)).toBe("first_tasks");
    expect(auditReason({ ...base, level: 1, tier1Audited: 20 }, 10)).toBeNull();
  });
  it("a level 2 clinician is only sampled", () => {
    expect(auditReason({ ...base, tier1Audited: 0 }, 10)).toBeNull();
    expect(auditReason({ ...base, draw: 9.99 }, 10)).toBe("random_sample");
    expect(auditReason({ ...base, draw: 10 }, 10)).toBeNull();
  });
  it("red events beat the tier 1 count", () => expect(auditReason({ ...base, level: 1, priorityClassOriginal: 1 }, 10)).toBe("red_event"));
});

describe("tier1ReadyForReview", () => {
  const rules = { graduation_min_score: 85, max_critical_misses: 0 };
  const ok = { level: 1 as const, submittedAudits: 20, target: 20, averageScore: 90, criticalMisses: 0 };
  it("is true when the count, the average and the misses all pass", () => expect(tier1ReadyForReview(ok, rules)).toBe(true));
  it("needs the full count", () => expect(tier1ReadyForReview({ ...ok, submittedAudits: 19 }, rules)).toBe(false));
  it("needs the average", () => expect(tier1ReadyForReview({ ...ok, averageScore: 84.9 }, rules)).toBe(false));
  it("allows no critical miss", () => expect(tier1ReadyForReview({ ...ok, criticalMisses: 1 }, rules)).toBe(false));
  it("a level 2 clinician has nothing to graduate", () => expect(tier1ReadyForReview({ ...ok, level: 2 }, rules)).toBe(false));
});

describe("lagosAuditMonth", () => {
  it("uses Lagos time, one hour ahead of UTC", () => {
    expect(lagosAuditMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
    expect(lagosAuditMonth(new Date("2026-10-31T22:59:00Z"))).toBe("2026-10-01");
  });
});
