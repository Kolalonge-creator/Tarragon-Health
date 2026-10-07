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
});
