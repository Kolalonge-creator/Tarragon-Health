/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { PatientSummaryView } from "./patient-summary";
import type { PatientSummary } from "@/lib/clinician/queue-console";

const base: PatientSummary = { status: "ok", patient_first_name: "Ada", care_circle: { active_members: 2 } };

describe("PatientSummaryView", () => {
  it("shows the audited-open note and the care circle as a count only", () => {
    render(<PatientSummaryView summary={base} />);
    expect(screen.getByText(/Opening this summary is recorded/)).toBeTruthy();
    expect(screen.getByText(/2 people are in this patient's care circle/)).toBeTruthy();
  });

  it("says so when sections were left out, and shows none of them", () => {
    render(<PatientSummaryView summary={{ ...base, status: "partial", denied: ["results"] }} />);
    expect(screen.getByText(/Some sections are not available to you/)).toBeTruthy();
    expect(screen.queryByText("Results")).toBeNull();
  });

  it("shows result state and panel but never a value", () => {
    render(
      <PatientSummaryView
        summary={{ ...base, results: [{ id: "r1", panel_code: "hba1c", release_state: "clinician_disclosure_required", received_at: "2026-10-01T10:00:00Z" }] }}
      />,
    );
    expect(screen.getByText(/hba1c: clinician disclosure required/)).toBeTruthy();
  });

  it("an empty readings window is said plainly, with the target band when there is one", () => {
    render(
      <PatientSummaryView
        summary={{ ...base, readings: { window_days: 14, rows: [], targets: [{ condition: "hypertension", target_ranges: { systolic: { max: 130 } } }] } }}
      />,
    );
    expect(screen.getByText(/No readings in the last 14 days/)).toBeTruthy();
    expect(screen.getByText(/Target: systolic 130/)).toBeTruthy();
  });

  it("does not claim an adherence figure the database could not give", () => {
    render(<PatientSummaryView summary={{ ...base, medications: { active: [], adherence: { percent: null } } }} />);
    expect(screen.getByText(/Not enough doses yet/)).toBeTruthy();
  });

  it("marks a shadow-free red triage event", () => {
    render(<PatientSummaryView summary={{ ...base, triage_events: [{ grade: "red", trigger_type: "observation", explanation_key: null, created_at: "2026-10-05T09:00:00Z" }] }} />);
    expect(screen.getByText("red")).toBeTruthy();
  });

  it("P6: a triage row shows the rule, the rule set version and the reading it was given", () => {
    render(
      <PatientSummaryView
        summary={{
          ...base,
          triage_events: [{
            grade: "amber", trigger_type: "observation", explanation_key: "TRI-003", created_at: "2026-10-05T09:00:00Z", rule_id: "BP-A2",
            rule_set_code: "bp_care_triage", rule_set_version: 3, context: { reading: { systolic: 152, diastolic: 96 }, cuffType: "wrist" },
          }],
        }}
      />,
    );
    expect(screen.getByText("Rule BP-A2, bp_care_triage version 3")).toBeTruthy();
    expect(screen.getByText("152/96 mmHg")).toBeTruthy();
  });

  it("P6: a reading row shows the cuff type when it was recorded, and nothing when it was not", () => {
    const row = { type: "bp", systolic: 150, diastolic: 95, value_numeric: null, unit: "mmHg", measured_at: "2026-10-05T09:00:00Z", source: "patient" };
    render(<PatientSummaryView summary={{ ...base, readings: { window_days: 14, targets: [], rows: [{ ...row, cuff_type: "wrist" }, { ...row, measured_at: "2026-10-04T09:00:00Z", cuff_type: null }] } }} />);
    expect(screen.getAllByText("Wrist cuff")).toHaveLength(1);
  });

  it("shows a symptom check summary the patient sent once it is tied to a booked consultation (S59)", () => {
    render(
      <PatientSummaryView
        summary={{
          ...base,
          symptom_summaries: [
            {
              id: "s1",
              sent_at: "2026-10-07T10:00:00Z",
              appointment_id: "ap1",
              payload: { complaint: "headache", complaint_label: "Headache", category: "urgent", onset: "gradual", severity: 6, associated_symptoms: ["fever"], questions: [{ prompt: "Has it lasted long?", answer: true }], red_flags_fired: [] },
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Symptom check summary")).toBeTruthy();
    expect(screen.getByText(/Headache/)).toBeTruthy();
    expect(screen.getByText(/Has it lasted long\?: yes/)).toBeTruthy();
  });

  it("shows no symptom summary section when there is none", () => {
    render(<PatientSummaryView summary={{ ...base, symptom_summaries: [] }} />);
    expect(screen.queryByText("Symptom check summary")).toBeNull();
  });
});
