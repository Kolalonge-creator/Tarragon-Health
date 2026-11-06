import { describe, expect, it } from "@jest/globals";
import { Constants } from "./database.types";
import {
  ACTIVE_ESCALATION_STATUSES,
  CLOSED_ESCALATION_STATUSES,
  ESCALATION_STATUS_LABEL,
  ESCALATION_STATUS_PATIENT_COPY,
  IN_PROGRESS_ESCALATION_STATUSES,
  isActiveEscalationStatus,
  isWorkingEscalationStatus,
  resolutionNoteProblem,
  workingStateProblem,
} from "./escalation-states";

const NOW = new Date("2026-11-06T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

describe("escalation states (DW-03)", () => {
  it("every status is either active or closed, never both and never neither", () => {
    for (const s of Constants.public.Enums.escalation_status) {
      const active = (ACTIVE_ESCALATION_STATUSES as readonly string[]).includes(s);
      const closed = (CLOSED_ESCALATION_STATUSES as readonly string[]).includes(s);
      expect(active !== closed).toBe(true);
      expect(isActiveEscalationStatus(s)).toBe(active);
    }
  });

  it("the three working states are open work and in progress", () => {
    for (const s of ["awaiting_information", "patient_contact_required", "monitoring"] as const) {
      expect(isActiveEscalationStatus(s)).toBe(true);
      expect(isWorkingEscalationStatus(s)).toBe(true);
      expect(IN_PROGRESS_ESCALATION_STATUSES).toContain(s);
    }
    expect(IN_PROGRESS_ESCALATION_STATUSES).not.toContain("open");
    expect(isWorkingEscalationStatus("under_review")).toBe(false);
  });

  it("has staff and patient wording for every status", () => {
    for (const s of Constants.public.Enums.escalation_status) {
      expect(ESCALATION_STATUS_LABEL[s].length).toBeGreaterThan(0);
      expect(ESCALATION_STATUS_PATIENT_COPY[s].length).toBeGreaterThan(0);
    }
  });
});

describe("workingStateProblem mirrors the database rules", () => {
  const base = { previousNote: null, monitorUntil: null, now: NOW } as const;

  it("needs a note of at least 10 characters", () => {
    expect(workingStateProblem({ ...base, status: "awaiting_information", note: "  short  " })).toMatch(/at least 10/);
    expect(workingStateProblem({ ...base, status: "awaiting_information", note: "Waiting for the ECG report" })).toBeNull();
  });

  it("needs a new note, not the previous one", () => {
    expect(
      workingStateProblem({ ...base, status: "patient_contact_required", note: "Waiting for the ECG report", previousNote: "Waiting for the ECG report " }),
    ).toMatch(/new note/);
  });

  it("monitoring needs a review-by date in the future and at most 14 days away", () => {
    const note = "Watch BP readings for a week";
    expect(workingStateProblem({ ...base, status: "monitoring", note })).toMatch(/review-by date/);
    expect(workingStateProblem({ ...base, status: "monitoring", note, monitorUntil: new Date(NOW.getTime() - 1000).toISOString() })).toMatch(/future/);
    expect(workingStateProblem({ ...base, status: "monitoring", note, monitorUntil: new Date(NOW.getTime() + 15 * day).toISOString() })).toMatch(/14 days/);
    expect(workingStateProblem({ ...base, status: "monitoring", note, monitorUntil: new Date(NOW.getTime() + 14 * day).toISOString() })).toBeNull();
  });

  it("a resolution note needs 10 characters (G11)", () => {
    expect(resolutionNoteProblem("ok")).not.toBeNull();
    expect(resolutionNoteProblem("ECG normal; patient reassured")).toBeNull();
  });
});
