import { describe, expect, it } from "@jest/globals";
import { deriveReferralPipelineStages, type ReferralPipelineInput } from "./pipeline-stages";

const base: ReferralPipelineInput = {
  status: "pending",
  urgency: null,
  specialist_provider_id: null,
  booking_confirmed_at: null,
  treatment_plan_received_at: null,
  shared_care_handback_at: null,
};

function stateOf(stages: ReturnType<typeof deriveReferralPipelineStages>, key: string) {
  return stages.find((s) => s.key === key)?.state;
}

describe("deriveReferralPipelineStages", () => {
  it("marks only the first stage complete for a freshly created referral", () => {
    const stages = deriveReferralPipelineStages(base);
    expect(stateOf(stages, "abnormal_result")).toBe("complete");
    expect(stateOf(stages, "awaiting_doctor_review")).toBe("current");
    expect(stateOf(stages, "doctor_assessment")).toBe("upcoming");
  });

  it("advances doctor assessment and referral approved once urgency is set", () => {
    const stages = deriveReferralPipelineStages({ ...base, urgency: "priority" });
    expect(stateOf(stages, "awaiting_doctor_review")).toBe("complete");
    expect(stateOf(stages, "doctor_assessment")).toBe("complete");
    expect(stateOf(stages, "referral_approved")).toBe("complete");
    expect(stateOf(stages, "finding_specialist")).toBe("current");
  });

  it("marks appointment booked complete once status reaches booked", () => {
    const stages = deriveReferralPipelineStages({
      ...base,
      urgency: "priority",
      specialist_provider_id: "provider-1",
      status: "booked",
      booking_confirmed_at: "2026-07-16T00:00:00.000Z",
    });
    expect(stateOf(stages, "finding_specialist")).toBe("complete");
    expect(stateOf(stages, "appointment_booked")).toBe("complete");
    expect(stateOf(stages, "consultation_completed")).toBe("current");
  });

  it("reaches monitoring continues once a treatment plan is recorded", () => {
    const stages = deriveReferralPipelineStages({
      ...base,
      urgency: "urgent",
      specialist_provider_id: "provider-1",
      status: "completed",
      booking_confirmed_at: "2026-07-16T00:00:00.000Z",
      treatment_plan_received_at: "2026-07-17T00:00:00.000Z",
    });
    expect(stateOf(stages, "consultation_completed")).toBe("complete");
    expect(stateOf(stages, "treatment_plan_received")).toBe("complete");
    expect(stateOf(stages, "monitoring_continues")).toBe("current");
  });

  it("skips downstream stages for a declined referral instead of leaving them upcoming", () => {
    const stages = deriveReferralPipelineStages({ ...base, urgency: "routine", status: "declined" });
    expect(stateOf(stages, "awaiting_doctor_review")).toBe("complete");
    expect(stateOf(stages, "finding_specialist")).toBe("skipped");
    expect(stateOf(stages, "monitoring_continues")).toBe("skipped");
  });
});
