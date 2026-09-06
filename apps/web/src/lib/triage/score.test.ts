import {
  scoreCase,
  rankCases,
  MAX_MODIFIER_POINTS,
  TRIAGE_ENGINE_VERSION,
  type TriageInput,
} from "./score";

const NOW = new Date("2026-08-07T12:00:00.000Z");

function input(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    level: "routine",
    slaDueAt: null,
    createdAt: "2026-08-07T11:00:00.000Z",
    ...overrides,
  };
}

describe("scoreCase — severity banding", () => {
  it("orders the five levels strictly by severity when nothing else differs", () => {
    const scores = (
      ["emergency", "specialist_review", "urgent_escalation", "clinician_review", "routine"] as const
    ).map((level) => scoreCase(input({ level }), NOW).score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(scores).size).toBe(5);
  });

  it("ranks by a clinician's override, not the system's own classification", () => {
    const overridden = scoreCase(
      input({ level: "routine", overrideLevel: "emergency" }),
      NOW
    );
    const plainEmergency = scoreCase(input({ level: "emergency" }), NOW);
    expect(overridden.score).toBe(plainEmergency.score);
  });
});

/**
 * The property the whole design rests on. If modifiers can ever bury a
 * severity band, a stack of small signals on a routine case can outrank a
 * live emergency -- a patient-safety bug, not a tuning problem. Asserted
 * against the constant rather than against a hand-picked worst case, so it
 * keeps holding when factors are added.
 */
describe("scoreCase — severity is never outweighed by modifiers", () => {
  it("keeps the modifier budget below the narrowest gap between two bands", () => {
    const bands = (
      ["emergency", "specialist_review", "urgent_escalation", "clinician_review", "routine"] as const
    ).map((level) => scoreCase(input({ level }), NOW).score);
    const gaps = bands.slice(1).map((score, i) => bands[i] - score);
    expect(Math.min(...gaps)).toBeGreaterThan(MAX_MODIFIER_POINTS);
  });

  it("cannot lift a maximally-aggravated routine case above a bare emergency", () => {
    const worstRoutine = scoreCase(
      input({
        level: "routine",
        slaDueAt: "2026-06-01T12:00:00.000Z", // months overdue
        createdAt: "2026-06-01T12:00:00.000Z",
        screeningResultStatus: "critical",
        priorEscalationCount: 9,
        activeConditionCount: 6,
        hasHighRiskScore: true,
      }),
      NOW
    );
    const bareEmergency = scoreCase(input({ level: "emergency" }), NOW);
    expect(worstRoutine.score).toBeLessThan(bareEmergency.score);
  });

  it("clamps the total modifier even when every factor fires at once", () => {
    const result = scoreCase(
      input({
        level: "emergency",
        slaDueAt: "2026-01-01T12:00:00.000Z",
        createdAt: "2026-01-01T12:00:00.000Z",
        screeningResultStatus: "critical",
        priorEscalationCount: 12,
        activeConditionCount: 8,
        hasHighRiskScore: true,
      }),
      NOW
    );
    const severityPoints = scoreCase(input({ level: "emergency" }), NOW).score;
    expect(result.score - severityPoints).toBeLessThanOrEqual(MAX_MODIFIER_POINTS);
  });
});

describe("scoreCase — SLA weighting", () => {
  it("scores a breached SLA above one merely due soon", () => {
    const breached = scoreCase(
      input({ slaDueAt: "2026-08-07T10:00:00.000Z" }), // 2h overdue
      NOW
    );
    const dueSoon = scoreCase(
      input({ slaDueAt: "2026-08-07T12:30:00.000Z" }), // 30m remaining
      NOW
    );
    expect(breached.score).toBeGreaterThan(dueSoon.score);
    expect(breached.factors.map((f) => f.key)).toContain("sla_breached");
    expect(dueSoon.factors.map((f) => f.key)).toContain("sla_imminent");
  });

  it("grades urgency as the deadline approaches rather than flipping at it", () => {
    const scores = [
      "2026-08-07T20:00:00.000Z", // 8h out — no factor
      "2026-08-07T15:00:00.000Z", // 3h out
      "2026-08-07T12:30:00.000Z", // 30m out
      "2026-08-07T11:00:00.000Z", // 1h overdue
    ].map((slaDueAt) => scoreCase(input({ slaDueAt }), NOW).score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  it("caps an ancient breach so one stale case cannot starve the queue", () => {
    const oldBreach = scoreCase(input({ slaDueAt: "2025-01-01T00:00:00.000Z" }), NOW);
    const factor = oldBreach.factors.find((f) => f.key === "sla_breached");
    expect(factor?.points).toBe(120);
  });

  it("adds no SLA factor when the alert carries no SLA", () => {
    const result = scoreCase(input({ slaDueAt: null }), NOW);
    expect(result.factors.map((f) => f.key).filter((k) => k.startsWith("sla_"))).toEqual([]);
  });
});

describe("scoreCase — abnormal screening results", () => {
  // CLAUDE.md: the Cat 2 -> 1 upgrade is the highest-priority business event
  // on the platform. It must visibly outrank an otherwise-identical case.
  it("lifts an abnormal screening result above an identical case without one", () => {
    const withResult = scoreCase(
      input({ level: "clinician_review", screeningResultStatus: "abnormal" }),
      NOW
    );
    const without = scoreCase(input({ level: "clinician_review" }), NOW);
    expect(withResult.score).toBeGreaterThan(without.score);
  });

  it("weights a critical result above an abnormal one", () => {
    const critical = scoreCase(input({ screeningResultStatus: "critical" }), NOW);
    const abnormal = scoreCase(input({ screeningResultStatus: "abnormal" }), NOW);
    expect(critical.score).toBeGreaterThan(abnormal.score);
  });

  it("ignores a normal result", () => {
    const normal = scoreCase(input({ screeningResultStatus: "normal" }), NOW);
    expect(normal.factors.map((f) => f.key)).not.toContain("abnormal_screening");
  });
});

describe("scoreCase — patient-blocked cases", () => {
  it("de-prioritises a case waiting on the patient", () => {
    const blocked = scoreCase(input({ level: "routine", awaitingPatientData: true }), NOW);
    const ready = scoreCase(input({ level: "routine" }), NOW);
    expect(blocked.score).toBeLessThan(ready.score);
  });

  it("never de-prioritises an emergency for waiting on the patient", () => {
    const blocked = scoreCase(input({ level: "emergency", awaitingPatientData: true }), NOW);
    expect(blocked.factors.map((f) => f.key)).not.toContain("awaiting_patient");
  });
});

describe("scoreCase — explainability", () => {
  it("makes the score exactly the sum of the factors it shows", () => {
    const result = scoreCase(
      input({
        level: "urgent_escalation",
        slaDueAt: "2026-08-07T12:30:00.000Z",
        priorEscalationCount: 2,
        activeConditionCount: 2,
      }),
      NOW
    );
    const shown = result.factors.reduce((sum, f) => sum + f.points, 0);
    expect(result.score).toBe(shown);
  });

  it("leads the explanation with severity, then the biggest modifier", () => {
    const result = scoreCase(
      input({
        level: "urgent_escalation",
        slaDueAt: "2026-08-07T10:00:00.000Z",
        activeConditionCount: 2,
      }),
      NOW
    );
    expect(result.factors[0].key).toBe("severity_urgent_escalation");
    expect(result.factors[1].key).toBe("sla_breached");
  });

  it("headlines the strongest modifier rather than repeating the visible badge", () => {
    const result = scoreCase(
      input({ level: "emergency", screeningResultStatus: "critical" }),
      NOW
    );
    expect(result.headline).toBe("Critical screening result awaiting review");
  });

  it("falls back to the severity label when nothing else applies", () => {
    expect(scoreCase(input({ level: "routine" }), NOW).headline).toBe("Routine");
  });

  it("stamps the engine version so a ranking can be traced to its rules", () => {
    expect(scoreCase(input(), NOW).engineVersion).toBe(TRIAGE_ENGINE_VERSION);
  });
});

describe("rankCases", () => {
  it("orders a mixed worklist highest-score first", () => {
    const rows = [
      { id: "routine", triage: input({ level: "routine" }) },
      { id: "emergency", triage: input({ level: "emergency" }) },
      { id: "overdue-review", triage: input({ level: "clinician_review", slaDueAt: "2026-08-07T08:00:00.000Z" }) },
    ];
    const ranked = rankCases(rows, (row) => row.triage, NOW);
    expect(ranked.map((r) => r.row.id)).toEqual(["emergency", "overdue-review", "routine"]);
  });

  it("ranks every case against one instant, so the list does not reorder under itself", () => {
    const rows = [input({ level: "routine" }), input({ level: "routine" })];
    const ranked = rankCases(rows, (row) => row, NOW);
    expect(ranked[0].triage.score).toBe(ranked[1].triage.score);
  });

  it("is stable for cases tied on score", () => {
    const rows = [
      { id: "a", triage: input({ level: "routine" }) },
      { id: "b", triage: input({ level: "routine" }) },
      { id: "c", triage: input({ level: "routine" }) },
    ];
    expect(rankCases(rows, (row) => row.triage, NOW).map((r) => r.row.id)).toEqual(["a", "b", "c"]);
  });
});
