import { selectAttachableAddOns, type AddOnOffer } from "./attachable-add-ons";

const LIFESTYLE: AddOnOffer = {
  code: "lifestyle-coaching",
  currency: "NGN",
  features: ["lifestyle_coaching", "ai_coach"],
  restricted_to_plan_code: null,
};
const PREVENTION: AddOnOffer = {
  code: "prevention-screening",
  currency: "NGN",
  features: ["prevention_coordination"],
  restricted_to_plan_code: null,
};
const USD_LIFESTYLE: AddOnOffer = { ...LIFESTYLE, code: "lifestyle-coaching_usd", currency: "USD" };

/** The real Complete Care feature list (subscription_plans.features). */
const COMPLETE_FEATURES = [
  "health_education",
  "clinician_review",
  "result_document_review",
  "medication_refills",
  "lifestyle_coaching",
  "vitals_red_flag_doctor_escalation",
  "quarterly_report",
  "async_doctor_visit",
  "doctor_checkin",
  "priority_escalation",
  "lab_coordination",
  "chronic",
  "prevention_coordination",
  "multi_condition_review",
  "ai_coach",
];
/** The real Essential Care feature list — no lifestyle_coaching, no ai_coach. */
const ESSENTIAL_FEATURES = [
  "clinician_review",
  "health_education",
  "result_document_review",
  "medication_refills",
  "vitals_red_flag_doctor_escalation",
  "doctor_checkin",
  "chronic",
  "lab_coordination",
  "prevention_coordination",
];

const base = {
  catalogue: [LIFESTYLE, PREVENTION, USD_LIFESTYLE],
  attached: [],
  currency: "NGN",
  currentPlanCode: "complete",
};

describe("selectAttachableAddOns", () => {
  it("offers a Complete Care subscriber nothing, because the plan already grants it all", () => {
    const result = selectAttachableAddOns({ ...base, planFeatures: COMPLETE_FEATURES });
    expect(result).toEqual([]);
  });

  it("still offers Lifestyle Coaching on Essential Care, which lacks it", () => {
    const result = selectAttachableAddOns({
      ...base,
      planFeatures: ESSENTIAL_FEATURES,
      currentPlanCode: "essential",
    });
    expect(result.map((a) => a.code)).toEqual(["lifestyle-coaching"]);
  });

  it("hides Prevention Screening on Essential Care, which already has prevention_coordination", () => {
    const result = selectAttachableAddOns({
      ...base,
      planFeatures: ESSENTIAL_FEATURES,
      currentPlanCode: "essential",
    });
    expect(result.map((a) => a.code)).not.toContain("prevention-screening");
  });

  it("offers both to a Free patient who has neither feature", () => {
    const result = selectAttachableAddOns({ ...base, planFeatures: [], currentPlanCode: "free" });
    expect(result.map((a) => a.code)).toEqual(["lifestyle-coaching", "prevention-screening"]);
  });

  it("counts features granted by an already-attached add-on, not just the plan", () => {
    const result = selectAttachableAddOns({
      ...base,
      planFeatures: ESSENTIAL_FEATURES,
      currentPlanCode: "essential",
      attached: [{ code: "lifestyle-coaching", features: ["lifestyle_coaching", "ai_coach"] }],
    });
    expect(result).toEqual([]);
  });

  it("offers an add-on that grants even one genuinely new feature", () => {
    const partly: AddOnOffer = {
      code: "coaching-plus",
      currency: "NGN",
      // ai_coach is already covered by Essential? No — Essential lacks it, so
      // this asserts the some() rather than every() semantics via a mix.
      features: ["health_education", "ai_coach"],
      restricted_to_plan_code: null,
    };
    const result = selectAttachableAddOns({
      ...base,
      catalogue: [partly],
      planFeatures: ESSENTIAL_FEATURES,
      currentPlanCode: "essential",
    });
    expect(result.map((a) => a.code)).toEqual(["coaching-plus"]);
  });

  it("keeps honouring the currency tab and plan restriction", () => {
    const restricted: AddOnOffer = {
      code: "complete-only",
      currency: "NGN",
      features: ["dedicated_coordinator"],
      restricted_to_plan_code: "complete",
    };
    expect(
      selectAttachableAddOns({
        ...base,
        catalogue: [restricted, USD_LIFESTYLE],
        planFeatures: ESSENTIAL_FEATURES,
        currentPlanCode: "essential",
      }),
    ).toEqual([]);
  });

  it("hides an add-on with no features rather than charging for an unknown", () => {
    const empty: AddOnOffer = {
      code: "mystery",
      currency: "NGN",
      features: [],
      restricted_to_plan_code: null,
    };
    expect(
      selectAttachableAddOns({ ...base, catalogue: [empty], planFeatures: [] }),
    ).toEqual([]);
  });
});
