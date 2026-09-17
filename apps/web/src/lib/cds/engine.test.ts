import { computeCdsRecommendations, type CdsEngineInput } from "./engine";
import type { SafetyReport } from "@/lib/rules/drug-safety";

const NOW = new Date("2026-08-29T10:00:00Z");

function emptySafetyReport(): SafetyReport {
  return {
    findings: [],
    renalCheckSkipped: null,
    allergyCheckNote: null,
    pregnancyCheckNote: null,
    isAdvisoryOnly: true,
  };
}

function baseInput(overrides: Partial<CdsEngineInput> = {}): CdsEngineInput {
  return {
    medicationSafety: emptySafetyReport(),
    hbpm: null,
    bpSecondaryFlags: [],
    pendingLabMonitoring: [],
    pendingConditionReviews: [],
    ckdRiskCategory: null,
    now: NOW,
    ...overrides,
  };
}

describe("computeCdsRecommendations — medication safety (§38.6/§38.7/§38.8)", () => {
  it("wraps each drug-safety finding as a recommendation, carrying severity into priority", () => {
    const report: SafetyReport = {
      findings: [
        {
          kind: "interaction",
          severity: "contraindicated",
          title: "Dual blockade of the renin-angiotensin system",
          message: "Stop one of them.",
          medicationIds: ["med-1", "med-2"],
          drugNames: ["Lisinopril", "Losartan"],
        },
        {
          kind: "allergy",
          severity: "caution",
          title: "Possible allergy conflict",
          message: "Patient has a recorded penicillin allergy.",
          medicationIds: ["med-3"],
          drugNames: ["Amoxicillin"],
        },
      ],
      renalCheckSkipped: null,
      allergyCheckNote: null,
      pregnancyCheckNote: null,
      isAdvisoryOnly: true,
    };

    const recs = computeCdsRecommendations(baseInput({ medicationSafety: report }));

    expect(recs).toHaveLength(2);
    const interaction = recs.find((r) => r.key.includes("interaction"))!;
    expect(interaction.priority).toBe("high");
    expect(interaction.category).toBe("medication_safety");
    expect(interaction.medicationIds).toEqual(["med-1", "med-2"]);
    expect(interaction.triggerText).toBe("Stop one of them.");

    const allergy = recs.find((r) => r.key.includes("allergy"))!;
    expect(allergy.priority).toBe("medium");
  });

  it("gives the same finding the same key+fingerprint across two independent computations (stability for the decision ledger)", () => {
    const finding: SafetyReport["findings"][number] = {
      kind: "duplicate_therapy",
      severity: "caution",
      title: "Duplicate ACE inhibitor",
      message: "Two ACE inhibitors are active.",
      medicationIds: ["med-9", "med-2"],
      drugNames: ["Ramipril", "Lisinopril"],
    };
    const report: SafetyReport = {
      findings: [finding],
      renalCheckSkipped: null,
      allergyCheckNote: null,
      pregnancyCheckNote: null,
      isAdvisoryOnly: true,
    };

    const a = computeCdsRecommendations(baseInput({ medicationSafety: report }))[0];
    const b = computeCdsRecommendations(baseInput({ medicationSafety: { ...report, findings: [{ ...finding }] } }))[0];

    expect(a.key).toBe(b.key);
    expect(a.fingerprint).toBe(b.fingerprint);
    // Medication order in the input must not change identity — sorted internally.
    const reordered = { ...finding, medicationIds: ["med-2", "med-9"] };
    const c = computeCdsRecommendations(
      baseInput({ medicationSafety: { ...report, findings: [reordered] } }),
    )[0];
    expect(c.key).toBe(a.key);
  });

  it("changes the fingerprint when severity changes for the same medications (e.g. eGFR worsened)", () => {
    const caution = computeCdsRecommendations(
      baseInput({
        medicationSafety: {
          findings: [
            {
              kind: "renal_dosing",
              severity: "caution",
              title: "Renal dosing",
              message: "Reduce dose.",
              medicationIds: ["med-1"],
              drugNames: ["Metformin"],
            },
          ],
          renalCheckSkipped: null,
          allergyCheckNote: null,
          pregnancyCheckNote: null,
          isAdvisoryOnly: true,
        },
      }),
    )[0];
    const contraindicated = computeCdsRecommendations(
      baseInput({
        medicationSafety: {
          findings: [
            {
              kind: "renal_dosing",
              severity: "contraindicated",
              title: "Renal dosing",
              message: "Stop metformin.",
              medicationIds: ["med-1"],
              drugNames: ["Metformin"],
            },
          ],
          renalCheckSkipped: null,
          allergyCheckNote: null,
          pregnancyCheckNote: null,
          isAdvisoryOnly: true,
        },
      }),
    )[0];

    expect(caution.key).toBe(contraindicated.key); // same recommendation identity
    expect(caution.fingerprint).not.toBe(contraindicated.fingerprint); // but the underlying fact changed
  });
});

describe("computeCdsRecommendations — BP control (§38.3 'BP remains uncontrolled')", () => {
  const hbpm = {
    target: { systolic: 130, diastolic: 80, source: "protocol default" },
    average: { systolic: 145, diastolic: 92, n_readings: 7, n_days: 7, meets_home_htn: true, at_target: false },
  };

  it("surfaces a recommendation when the home average is above target", () => {
    const recs = computeCdsRecommendations(baseInput({ hbpm }));
    expect(recs).toHaveLength(1);
    expect(recs[0].key).toBe("bp_uncontrolled");
    expect(recs[0].title).toBe("BP remains uncontrolled.");
    expect(recs[0].triggerText).toContain("145/92");
    expect(recs[0].triggerText).toContain("130/80");
    expect(recs[0].sourceLabel).toContain("protocol default");
  });

  it("says nothing when at target (a clean panel, never a false alarm)", () => {
    const recs = computeCdsRecommendations(
      baseInput({ hbpm: { ...hbpm, average: { ...hbpm.average, at_target: true } } }),
    );
    expect(recs).toHaveLength(0);
  });

  it("says nothing when there is no home average on file yet", () => {
    const recs = computeCdsRecommendations(baseInput({ hbpm: { ...hbpm, average: null } }));
    expect(recs).toHaveLength(0);
  });

  describe("severity gradient (mirrors private.classify_bp_level's EMERGENCY/RED/AMBER bands)", () => {
    it("is 'low' priority for a mildly above-target average, below every population red-flag threshold", () => {
      const recs = computeCdsRecommendations(
        baseInput({ hbpm: { ...hbpm, average: { ...hbpm.average, systolic: 134, diastolic: 84 } } }),
      );
      expect(recs[0].priority).toBe("low");
      expect(recs[0].triggerText).not.toContain("crisis");
      expect(recs[0].triggerText).not.toContain("urgent");
    });

    it("is 'medium' priority for the AMBER band (systolic 135-159 or diastolic 85-99)", () => {
      const recs = computeCdsRecommendations(
        baseInput({ hbpm: { ...hbpm, average: { ...hbpm.average, systolic: 145, diastolic: 92 } } }),
      );
      expect(recs[0].priority).toBe("medium");
    });

    it("is 'high' priority for the RED band (systolic 160-199 or diastolic 100-119) and notes it's urgent", () => {
      const recs = computeCdsRecommendations(
        baseInput({ hbpm: { ...hbpm, average: { ...hbpm.average, systolic: 165, diastolic: 95 } } }),
      );
      expect(recs[0].priority).toBe("high");
      expect(recs[0].triggerText).toContain("urgent, same-day-review range");
    });

    it("is 'high' priority for a diastolic-only crisis (diastolic >= 120) and names the crisis range", () => {
      const recs = computeCdsRecommendations(
        baseInput({ hbpm: { ...hbpm, average: { ...hbpm.average, systolic: 150, diastolic: 130 } } }),
      );
      expect(recs[0].priority).toBe("high");
      expect(recs[0].triggerText).toContain("hypertensive-crisis range");
    });

    it("is 'high' priority for the live crisis case (205/130) — never the same priority as a barely-above-target reading", () => {
      const crisis = computeCdsRecommendations(
        baseInput({ hbpm: { ...hbpm, average: { ...hbpm.average, systolic: 205, diastolic: 130 } } }),
      )[0];
      const mild = computeCdsRecommendations(
        baseInput({ hbpm: { ...hbpm, average: { ...hbpm.average, systolic: 136, diastolic: 86 } } }),
      )[0];
      expect(crisis.priority).toBe("high");
      expect(mild.priority).toBe("medium");
      expect(crisis.priority).not.toBe(mild.priority);
    });

    it("grades the systolic and diastolic bands independently — the more severe of the two wins", () => {
      // Systolic alone is only AMBER-range, but diastolic 105 is RED-range.
      const recs = computeCdsRecommendations(
        baseInput({ hbpm: { ...hbpm, average: { ...hbpm.average, systolic: 140, diastolic: 105 } } }),
      );
      expect(recs[0].priority).toBe("high");
    });
  });
});

describe("computeCdsRecommendations — referral pathway (§38.3 'Referral pathway may be appropriate')", () => {
  it("surfaces resistant HTN as high priority", () => {
    const recs = computeCdsRecommendations(baseInput({ bpSecondaryFlags: ["resistant_htn"] }));
    expect(recs).toHaveLength(1);
    expect(recs[0].key).toBe("referral:resistant_htn");
    expect(recs[0].priority).toBe("high");
  });

  it("surfaces young-onset HTN as medium priority", () => {
    const recs = computeCdsRecommendations(baseInput({ bpSecondaryFlags: ["young_onset_under_40"] }));
    expect(recs[0].priority).toBe("medium");
  });

  it("ignores an unrecognised flag rather than guessing at copy for it", () => {
    const recs = computeCdsRecommendations(baseInput({ bpSecondaryFlags: ["some_future_flag"] }));
    expect(recs).toHaveLength(0);
  });

  it("surfaces a nephrology referral at very-high KDIGO risk only", () => {
    expect(computeCdsRecommendations(baseInput({ ckdRiskCategory: "high" }))).toHaveLength(0);
    const recs = computeCdsRecommendations(baseInput({ ckdRiskCategory: "very_high" }));
    expect(recs).toHaveLength(1);
    expect(recs[0].key).toBe("referral:ckd_very_high");
    expect(recs[0].priority).toBe("high");
  });
});

describe("computeCdsRecommendations — monitoring (§38.9/§38.10)", () => {
  it("surfaces overdue drug-triggered lab monitoring", () => {
    const recs = computeCdsRecommendations(
      baseInput({
        pendingLabMonitoring: [
          { id: "m1", medicationId: "med-1", drugClass: "ACE inhibitor", monitoringLabel: "U&E and potassium", dueDate: "2026-08-01" },
        ],
      }),
    );
    expect(recs).toHaveLength(1);
    expect(recs[0].title).toBe("Medication monitoring is due.");
    expect(recs[0].triggerText).toContain("2026-08-01");
  });

  it("does not surface monitoring that is not yet due", () => {
    const recs = computeCdsRecommendations(
      baseInput({
        pendingLabMonitoring: [
          { id: "m1", medicationId: "med-1", drugClass: "Statin", monitoringLabel: "LFTs", dueDate: "2099-01-01" },
        ],
      }),
    );
    expect(recs).toHaveLength(0);
  });

  it("never alerts on 'as clinically indicated' monitoring with no due date", () => {
    const recs = computeCdsRecommendations(
      baseInput({
        pendingLabMonitoring: [{ id: "m1", medicationId: "med-1", drugClass: "Statin", monitoringLabel: "LFTs", dueDate: null }],
      }),
    );
    expect(recs).toHaveLength(0);
  });

  it("titles a diabetes review as 'Diabetes monitoring is overdue.' and others generically", () => {
    const recs = computeCdsRecommendations(
      baseInput({
        pendingConditionReviews: [
          { id: "r1", condition: "diabetes", dueDate: "2026-08-01" },
          { id: "r2", condition: "cardiovascular", dueDate: "2026-08-01" },
        ],
      }),
    );
    expect(recs.find((r) => r.key === "condition_review:r1")?.title).toBe("Diabetes monitoring is overdue.");
    expect(recs.find((r) => r.key === "condition_review:r2")?.title).toBe("Cardiovascular risk review is due.");
  });

  it("does not surface a review that is not yet due", () => {
    const recs = computeCdsRecommendations(
      baseInput({ pendingConditionReviews: [{ id: "r1", condition: "diabetes", dueDate: "2099-01-01" }] }),
    );
    expect(recs).toHaveLength(0);
  });
});

describe("computeCdsRecommendations — composition", () => {
  it("returns nothing for a clean chart (never invents a recommendation)", () => {
    expect(computeCdsRecommendations(baseInput())).toEqual([]);
  });

  it("composes every rule family together without cross-contamination", () => {
    const recs = computeCdsRecommendations(
      baseInput({
        medicationSafety: {
          findings: [
            {
              kind: "interaction",
              severity: "contraindicated",
              title: "Dual RAS blockade",
              message: "Stop one.",
              medicationIds: ["med-1"],
              drugNames: ["Lisinopril"],
            },
          ],
          renalCheckSkipped: null,
          allergyCheckNote: null,
          pregnancyCheckNote: null,
          isAdvisoryOnly: true,
        },
        hbpm: {
          target: { systolic: 130, diastolic: 80, source: "doctor-set" },
          average: { systolic: 150, diastolic: 95, n_readings: 5, n_days: 7, meets_home_htn: true, at_target: false },
        },
        bpSecondaryFlags: ["resistant_htn"],
        pendingLabMonitoring: [
          { id: "m1", medicationId: "med-2", drugClass: "Statin", monitoringLabel: "LFTs", dueDate: "2026-08-01" },
        ],
        pendingConditionReviews: [{ id: "r1", condition: "diabetes", dueDate: "2026-08-01" }],
        ckdRiskCategory: "very_high",
      }),
    );
    expect(recs).toHaveLength(6);
    expect(new Set(recs.map((r) => r.category))).toEqual(
      new Set(["medication_safety", "chronic_disease_control", "referral", "monitoring"]),
    );
  });
});
