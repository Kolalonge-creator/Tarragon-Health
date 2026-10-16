import { describe, expect, it } from "@jest/globals";
import { EXTRA_PRODUCER_NOTE, formatMinutes, LEAD_SKIP_EXPLANATION, taskTypeSchema, taskTypeSearchWords, TASK_TYPE_LABEL } from "./task-types";

describe("task types", () => {
  it("formats minutes the way people say them", () => {
    expect(formatMinutes(0)).toBe("None");
    expect(formatMinutes(1440)).toBe("1 day");
    expect(formatMinutes(2880)).toBe("2 days");
    expect(formatMinutes(60)).toBe("1 hour");
    expect(formatMinutes(240)).toBe("4 hours");
    expect(formatMinutes(45)).toBe("45 minutes");
  });

  it("makes adherence_follow_up findable by its code, its words and its name", () => {
    const words = taskTypeSearchWords("adherence_follow_up");
    expect(words).toContain("adherence_follow_up");
    expect(words).toContain("adherence follow up");
    expect(words).toContain(TASK_TYPE_LABEL["adherence_follow_up"]);
    expect(taskTypeSearchWords("unknown_code")).toBe("unknown_code unknown code");
  });

  it("rejects a row with an unknown tier or a class outside 1 to 9", () => {
    const row = { code: "x", priority_class: 4, default_due_minutes: 10, min_doctor_tier: "senior_medical_officer", required_competencies: [], lead_window_minutes: 0, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: [], note: null, needs_confirmation: false, confirmed_at: null, confirmation_note: null };
    expect(taskTypeSchema.safeParse(row).success).toBe(true);
    expect(taskTypeSchema.safeParse({ ...row, min_doctor_tier: "nurse" }).success).toBe(false);
    expect(taskTypeSchema.safeParse({ ...row, priority_class: 10 }).success).toBe(false);
  });
});

describe("task types: skills the database adds (OQ-433) and the lead skip note (OQ-435)", () => {
  it("names the symptom checker as a producer of symptom_review, and labels the pharmacy flag type", () => {
    expect(EXTRA_PRODUCER_NOTE["symptom_review"]).toContain("symptom check");
    expect(TASK_TYPE_LABEL["pharmacy_flag_review"]).toBe("Pharmacy flag on a prescription");
  });

  it("explains that a named clinician without a needed skill is skipped and the history says why", () => {
    expect(LEAD_SKIP_EXPLANATION).toContain("not offered it");
    expect(LEAD_SKIP_EXPLANATION).toContain("Work that can be offered to an employed doctor");
    expect(LEAD_SKIP_EXPLANATION).toContain("task history says why");
  });
});
