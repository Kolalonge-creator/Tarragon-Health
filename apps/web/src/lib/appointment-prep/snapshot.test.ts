import { describe, expect, it } from "@jest/globals";
import { formatAppointmentPrepSnapshotForPrompt, type AppointmentPrepSnapshot } from "./snapshot";

function snapshot(overrides: Partial<AppointmentPrepSnapshot> = {}): AppointmentPrepSnapshot {
  return {
    context: "general_checkin",
    scheduledAt: "2026-08-30T10:00:00.000Z",
    conditions: ["Hypertension"],
    escalationReason: null,
    ...overrides,
  };
}

describe("formatAppointmentPrepSnapshotForPrompt", () => {
  it("includes the visit type and known conditions", () => {
    const text = formatAppointmentPrepSnapshotForPrompt(snapshot());
    expect(text).toContain("a general check-in");
    expect(text).toContain("Hypertension");
  });

  it("says plainly when there's no flagged concern, rather than inventing a reason", () => {
    const text = formatAppointmentPrepSnapshotForPrompt(snapshot());
    expect(text).toContain("No specific flagged concern on file");
  });

  it("includes the escalation reason when one exists", () => {
    const text = formatAppointmentPrepSnapshotForPrompt(
      snapshot({ escalationReason: "Blood pressure reading flagged as high" })
    );
    expect(text).toContain('Blood pressure reading flagged as high');
    expect(text).not.toContain("No specific flagged concern on file");
  });

  it("says plainly when there are no active conditions, rather than omitting the line", () => {
    const text = formatAppointmentPrepSnapshotForPrompt(snapshot({ conditions: [] }));
    expect(text).toContain("No active care-plan conditions on file.");
  });

  it("falls back to the raw context value for an unrecognised visit type", () => {
    const text = formatAppointmentPrepSnapshotForPrompt(snapshot({ context: "something_new" }));
    expect(text).toContain("Visit type: something_new");
  });
});
