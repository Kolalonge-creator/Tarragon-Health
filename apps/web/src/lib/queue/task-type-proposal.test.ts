import { describe, expect, it } from "@jest/globals";
import { taskTypeProposalSchema, toProposalRpcArgs } from "./task-type-proposal";

const base = {
  code: "maternal_review",
  priorityClass: "4",
  defaultDueMinutes: "1440",
  minTier: "medical_officer",
  requiredCompetencies: "maternal, adult_general",
  leadWindowMinutes: "0",
  claimTimeoutMinutes: "30",
  pushable: false,
  sourceTaskKeys: "",
  note: "",
};

describe("taskTypeProposalSchema", () => {
  it("parses a form into the RPC arguments", () => {
    const args = toProposalRpcArgs(taskTypeProposalSchema.parse(base));
    expect(args).toEqual({
      p_code: "maternal_review",
      p_priority_class: 4,
      p_default_due_minutes: 1440,
      p_min_tier: "medical_officer",
      p_required_competencies: ["maternal", "adult_general"],
      p_lead_window_minutes: 0,
      p_claim_timeout_minutes: 30,
      p_pushable: false,
      p_source_task_keys: [],
      p_note: null,
    });
  });

  it("refuses a bad code, a class out of range and a negative time", () => {
    expect(taskTypeProposalSchema.safeParse({ ...base, code: "Bad Code" }).success).toBe(false);
    expect(taskTypeProposalSchema.safeParse({ ...base, priorityClass: "10" }).success).toBe(false);
    expect(taskTypeProposalSchema.safeParse({ ...base, defaultDueMinutes: "-5" }).success).toBe(false);
  });

  it("refuses a class 1 task with a named clinician window", () => {
    expect(taskTypeProposalSchema.safeParse({ ...base, priorityClass: "1", leadWindowMinutes: "30" }).success).toBe(false);
    expect(taskTypeProposalSchema.safeParse({ ...base, priorityClass: "1", leadWindowMinutes: "0" }).success).toBe(true);
  });
});
