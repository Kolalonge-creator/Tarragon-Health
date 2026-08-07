import {
  proposeActions,
  matchRedFlags,
  PROPOSAL_ENGINE_VERSION,
  type CaseFacts,
} from "./propose";
import type { ResolvedProtocol } from "./protocol";

const NOW = new Date("2026-08-07T12:00:00.000Z");

function protocol(overrides: Partial<ResolvedProtocol> = {}): ResolvedProtocol {
  return {
    condition: "hypertension",
    protocolSlug: "chronic_hypertension_who",
    summary: "Blood-pressure control.",
    source: "World Health Organization",
    monitoring: { targets: ["BP < 140/90 mmHg"], vitals: ["blood_pressure"], cadence: "Every 3 months" },
    escalation: { redFlags: [], sla: null },
    investigations: { baseline: [], ongoing: [] },
    followUp: [],
    signedVersion: { id: "pv-1", versionNumber: 3, title: "Hypertension protocol", approvedAt: "2026-07-01T00:00:00.000Z" },
    ...overrides,
  };
}

function facts(overrides: Partial<CaseFacts> = {}): CaseFacts {
  return {
    alert: { title: "BP 150/95 logged", level: "clinician_review", overrideLevel: null, detail: null },
    escalation: null,
    medications: [],
    dueScreenings: [],
    reviewCadenceMonths: null,
    redFlags: { breached: [], requiresJudgement: [], cleared: [] },
    protocol: null,
    ...overrides,
  };
}

/** Invariant 1 — no proposal without a stated reason. */
describe("proposeActions — every proposal is justified", () => {
  it("gives every proposal a non-empty rationale", () => {
    const proposals = proposeActions(
      facts({
        protocol: protocol(),
        reviewCadenceMonths: 3,
        escalation: { id: "esc-1", status: "under_review" },
        medications: [{ id: "med-1", name: "Amlodipine 5mg", refillDate: "2026-08-01" }],
        dueScreenings: [
          { id: "sch-1", screenName: "Renal function", panelBundleId: "pb-1", dueDate: "2026-07-01" },
        ],
      }),
      NOW
    );
    expect(proposals.length).toBeGreaterThan(3);
    for (const proposal of proposals) {
      expect(proposal.rationale.trim().length).toBeGreaterThan(0);
      expect(proposal.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("names the triggering fact in the rationale, not a generic recommendation", () => {
    const [, , refill] = proposeActions(
      facts({
        protocol: protocol(),
        reviewCadenceMonths: 3,
        medications: [{ id: "med-1", name: "Amlodipine 5mg", refillDate: "2026-08-01" }],
      }),
      NOW
    );
    expect(refill.rationale).toContain("Amlodipine 5mg");
    expect(refill.rationale).toContain("2026-08-01");
  });
});

/** Invariant 2 — protocol backing is claimed only when it exists. */
describe("proposeActions — protocol backing is never implied", () => {
  it("carries the signed version id when the protocol is signed", () => {
    const proposals = proposeActions(facts({ protocol: protocol() }), NOW);
    expect(proposals.every((p) => p.protocolVersionId === "pv-1")).toBe(true);
  });

  it("carries a null version id and says so when the protocol is unsigned", () => {
    const proposals = proposeActions(
      facts({ protocol: protocol({ signedVersion: null }) }),
      NOW
    );
    expect(proposals.every((p) => p.protocolVersionId === null)).toBe(true);
    expect(proposals[0].rationale).toContain("no signed version yet");
  });

  it("carries a null version id when no protocol applies at all", () => {
    const proposals = proposeActions(facts(), NOW);
    expect(proposals.every((p) => p.protocolVersionId === null)).toBe(true);
    expect(proposals[0].rationale).toContain("No condition protocol applies");
  });
});

/** Invariant 3 — the shortcut never makes closing easier than looking. */
describe("proposeActions — resolve is suppressed by a breached red flag", () => {
  it("offers no resolve action when the data breaches a protocol threshold", () => {
    const proposals = proposeActions(
      facts({
        protocol: protocol(),
        escalation: { id: "esc-1", status: "under_review" },
        redFlags: { breached: ["BP >= 180/120 without symptoms"], requiresJudgement: [], cleared: [] },
      }),
      NOW
    );
    expect(proposals.map((p) => p.actionType)).not.toContain("resolve_case");
  });

  it("offers resolve when thresholds are cleared, with judgement criteria attached", () => {
    const proposals = proposeActions(
      facts({
        protocol: protocol(),
        escalation: { id: "esc-1", status: "under_review" },
        redFlags: {
          breached: [],
          requiresJudgement: ["Signs of target-organ damage"],
          cleared: ["BP >= 180/120 without symptoms"],
        },
      }),
      NOW
    );
    const resolve = proposals.find((p) => p.actionType === "resolve_case");
    expect(resolve).toBeDefined();
    expect(resolve?.payload).toMatchObject({
      kind: "resolve_case",
      judgementChecklist: ["Signs of target-organ damage"],
    });
    expect(resolve?.rationale).toContain("cannot be judged from data");
  });

  it("never offers resolve on a case that has not been escalated", () => {
    const proposals = proposeActions(facts({ protocol: protocol(), escalation: null }), NOW);
    expect(proposals.map((p) => p.actionType)).not.toContain("resolve_case");
  });

  it("never offers resolve on an already-resolved escalation", () => {
    const proposals = proposeActions(
      facts({ escalation: { id: "esc-1", status: "resolved" } }),
      NOW
    );
    expect(proposals.map((p) => p.actionType)).not.toContain("resolve_case");
  });

  it("puts resolve last, so it is never the first thing offered", () => {
    const proposals = proposeActions(
      facts({
        protocol: protocol(),
        reviewCadenceMonths: 3,
        escalation: { id: "esc-1", status: "under_review" },
      }),
      NOW
    );
    expect(proposals[proposals.length - 1].actionType).toBe("resolve_case");
  });
});

/** Invariant 4 — proposing never routes around a tier gate. */
describe("proposeActions — required authority matches the underlying write", () => {
  it("demands emergency authority to resolve an emergency-level case", () => {
    const proposals = proposeActions(
      facts({
        alert: { title: "Severe BP", level: "emergency", overrideLevel: null, detail: null },
        escalation: { id: "esc-1", status: "under_review" },
      }),
      NOW
    );
    expect(proposals.find((p) => p.actionType === "resolve_case")?.requiredAuthority).toBe(
      "emergency_resolution"
    );
  });

  it("still demands emergency authority when a clinician overrode the level DOWN", () => {
    // Mirrors the DB predicate: level OR override_level, never coalesce —
    // otherwise a Tier 1 downgrades an emergency and unlocks their own resolve.
    const proposals = proposeActions(
      facts({
        alert: { title: "Severe BP", level: "emergency", overrideLevel: "routine", detail: null },
        escalation: { id: "esc-1", status: "under_review" },
      }),
      NOW
    );
    expect(proposals.find((p) => p.actionType === "resolve_case")?.requiredAuthority).toBe(
      "emergency_resolution"
    );
  });

  it("engages the gate when a routine case is overridden UP to emergency", () => {
    const proposals = proposeActions(
      facts({
        alert: { title: "BP", level: "routine", overrideLevel: "emergency", detail: null },
        escalation: { id: "esc-1", status: "under_review" },
      }),
      NOW
    );
    expect(proposals.find((p) => p.actionType === "resolve_case")?.requiredAuthority).toBe(
      "emergency_resolution"
    );
  });

  it("asks only for refill confirmation authority on a refill, never prescribing", () => {
    const proposals = proposeActions(
      facts({ medications: [{ id: "med-1", name: "Amlodipine 5mg", refillDate: "2026-08-01" }] }),
      NOW
    );
    expect(proposals.find((p) => p.actionType === "confirm_medication_refill")?.requiredAuthority).toBe(
      "refill_confirmation"
    );
  });

  it("requires prescribing authority to order an investigation", () => {
    const proposals = proposeActions(
      facts({
        dueScreenings: [
          { id: "sch-1", screenName: "Renal function", panelBundleId: "pb-1", dueDate: "2026-07-01" },
        ],
      }),
      NOW
    );
    expect(proposals.find((p) => p.actionType === "order_investigation")?.requiredAuthority).toBe(
      "prescribing"
    );
  });
});

describe("proposeActions — individual rules", () => {
  it("always proposes a review note, even for a bare case", () => {
    expect(proposeActions(facts(), NOW).map((p) => p.actionType)).toEqual(["log_review_note"]);
  });

  it("schedules follow-up at the programme's structured cadence", () => {
    const followUp = proposeActions(facts({ reviewCadenceMonths: 6 }), NOW).find(
      (p) => p.actionType === "schedule_follow_up"
    );
    expect(followUp?.payload).toMatchObject({ kind: "schedule_follow_up" });
    if (followUp?.payload.kind === "schedule_follow_up") {
      expect(followUp.payload.nextFollowUpAt.slice(0, 7)).toBe("2027-02");
    }
  });

  it("proposes no follow-up when the patient has no structured cadence", () => {
    // Deliberately not parsed out of the protocol's free-text cadence prose —
    // guessing a clinical interval from English would be inventing one.
    const proposals = proposeActions(
      facts({ protocol: protocol({ monitoring: { targets: [], vitals: [], cadence: "Every 3 months" } }) }),
      NOW
    );
    expect(proposals.map((p) => p.actionType)).not.toContain("schedule_follow_up");
  });

  it("proposes a refill only once the refill date has actually arrived", () => {
    const notYet = proposeActions(
      facts({ medications: [{ id: "m", name: "Amlodipine", refillDate: "2026-12-01" }] }),
      NOW
    );
    expect(notYet.map((p) => p.actionType)).not.toContain("confirm_medication_refill");
  });

  it("ignores a medication with no refill date on file", () => {
    const proposals = proposeActions(
      facts({ medications: [{ id: "m", name: "Amlodipine", refillDate: null }] }),
      NOW
    );
    expect(proposals.map((p) => p.actionType)).not.toContain("confirm_medication_refill");
  });

  it("picks the longest-overdue medication when several are due", () => {
    const proposals = proposeActions(
      facts({
        medications: [
          { id: "newer", name: "Metformin", refillDate: "2026-08-05" },
          { id: "older", name: "Amlodipine", refillDate: "2026-06-01" },
        ],
      }),
      NOW
    );
    const refill = proposals.find((p) => p.actionType === "confirm_medication_refill");
    expect(refill?.payload).toMatchObject({ medicationId: "older" });
  });

  it("will not order an investigation with no catalogue bundle behind it", () => {
    const proposals = proposeActions(
      facts({
        dueScreenings: [
          { id: "sch-1", screenName: "Foot exam", panelBundleId: null, dueDate: "2026-07-01" },
        ],
      }),
      NOW
    );
    expect(proposals.map((p) => p.actionType)).not.toContain("order_investigation");
  });

  it("is pure — the same facts and instant produce an identical result", () => {
    const input = facts({
      protocol: protocol(),
      reviewCadenceMonths: 3,
      escalation: { id: "esc-1", status: "under_review" },
    });
    expect(proposeActions(input, NOW)).toEqual(proposeActions(input, NOW));
  });

  it("exposes an engine version so a proposal can be traced to its rules", () => {
    expect(PROPOSAL_ENGINE_VERSION).toBeGreaterThan(0);
  });
});

describe("matchRedFlags", () => {
  const withFlags = (redFlags: string[]) =>
    protocol({ escalation: { redFlags, sla: null } });

  it("breaches a numeric threshold the patient's reading exceeds", () => {
    const result = matchRedFlags(withFlags(["BP >= 180/120 without symptoms"]), [
      { systolic: 185, diastolic: 100 },
    ]);
    expect(result.breached).toEqual(["BP >= 180/120 without symptoms"]);
    expect(result.cleared).toEqual([]);
  });

  it("clears a numeric threshold the reading is under", () => {
    const result = matchRedFlags(withFlags(["BP >= 180/120 without symptoms"]), [
      { systolic: 150, diastolic: 95 },
    ]);
    expect(result.cleared).toEqual(["BP >= 180/120 without symptoms"]);
    expect(result.breached).toEqual([]);
  });

  it("breaches on the diastolic limit alone", () => {
    const result = matchRedFlags(withFlags(["BP >= 180/120 without symptoms"]), [
      { systolic: 130, diastolic: 125 },
    ]);
    expect(result.breached).toHaveLength(1);
  });

  it("routes a non-numeric clinical sign to the doctor rather than evaluating it", () => {
    // The case that broke the first design: WHO hypertension lists this, no
    // vitals row can ever decide it, and treating it as unresolved would have
    // suppressed the resolve shortcut on every hypertension case forever.
    const result = matchRedFlags(
      withFlags(["Signs of target-organ damage (heart failure, renal impairment, retinopathy)"]),
      [{ systolic: 120, diastolic: 80 }]
    );
    expect(result.requiresJudgement).toHaveLength(1);
    expect(result.breached).toEqual([]);
    expect(result.cleared).toEqual([]);
  });

  it("never clears a threshold when there is no reading to test it against", () => {
    const result = matchRedFlags(withFlags(["BP >= 180/120 without symptoms"]), []);
    expect(result.requiresJudgement).toHaveLength(1);
    expect(result.cleared).toEqual([]);
  });

  it("sorts a realistic mixed WHO red-flag list correctly", () => {
    const result = matchRedFlags(
      withFlags([
        "BP >= 180/110 with symptoms (chest pain, breathlessness) - emergency",
        "BP >= 180/120 without symptoms - urgent same-day clinician review",
        "Signs of target-organ damage (heart failure, renal impairment, retinopathy)",
      ]),
      [{ systolic: 182, diastolic: 112 }]
    );
    expect(result.breached).toHaveLength(2);
    expect(result.requiresJudgement).toHaveLength(1);
    expect(result.cleared).toHaveLength(0);
  });

  it("returns nothing for a protocol with no red flags, or no protocol at all", () => {
    expect(matchRedFlags(withFlags([]), [{ systolic: 200, diastolic: 130 }])).toEqual({
      breached: [],
      requiresJudgement: [],
      cleared: [],
    });
    expect(matchRedFlags(null, [{ systolic: 200, diastolic: 130 }]).breached).toEqual([]);
  });
});
