/** @jest-environment jsdom */
/**
 * S05b-e: the record changes queue. A row shows the patient, the allergy as recorded, what she asks for and when; opening it shows the
 * current record and the request side by side; the decision buttons exist only for a doctor; the reject note says it is internal.
 */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("./actions", () => ({
  confirmRecordChange: jest.fn(),
  rejectRecordChange: jest.fn(),
}));

import { describeRequest, RecordChangesQueue, type RecordChangeRequest } from "./record-changes-queue";

const VOID_REQUEST: RecordChangeRequest = {
  id: "r1",
  kind: "allergy",
  requested_status: "entered_in_error",
  reason: "I never had this reaction",
  replacement: null,
  created_at: "2026-10-12T09:30:00Z",
  patient: { full_name: "Ada Obi", patient_number: "TH-0042" },
  allergy: { allergen: "Peanut", reaction: "Hives", severity: "moderate", source: "patient", noted_at: "2026-01-01" },
  currentUnavailable: false,
  condition: null,
};

const CORRECT_REQUEST: RecordChangeRequest = {
  id: "r2",
  kind: "allergy",
  requested_status: "corrected",
  reason: "It is milder than I wrote",
  replacement: { allergen: "Peanut", severity: "mild" },
  created_at: "2026-10-13T09:30:00Z",
  patient: { full_name: "Bayo Ade", patient_number: null },
  allergy: { allergen: "Peanut", reaction: null, severity: "severe", source: "patient", noted_at: null },
  currentUnavailable: false,
  condition: null,
};

const CONDITION_VOID: RecordChangeRequest = {
  id: "r3",
  kind: "condition",
  requested_status: "entered_in_error",
  reason: "I never had gout",
  replacement: null,
  created_at: "2026-10-14T09:30:00Z",
  patient: { full_name: "Chidi Eze", patient_number: "TH-0077" },
  allergy: null,
  condition: { condition_name: "Gout", icd10_code: "M10", status: "active", source: "patient", date_identified: "2024-05-01" },
  currentUnavailable: false,
};

const CONDITION_CORRECT: RecordChangeRequest = {
  ...CONDITION_VOID,
  id: "r4",
  requested_status: "corrected",
  reason: "It is gouty arthritis",
  replacement: { condition_name: "Gouty arthritis" },
};

describe("describeRequest", () => {
  it("says remove for a void and names the replacement for a correction", () => {
    expect(describeRequest(VOID_REQUEST)).toMatch(/remove/i);
    expect(describeRequest(CORRECT_REQUEST)).toBe("Change to: Peanut, Mild");
  });

  it("speaks of a condition for a condition request", () => {
    expect(describeRequest(CONDITION_VOID)).toBe("Remove this condition (entered by mistake)");
    expect(describeRequest(CONDITION_CORRECT)).toBe("Change to: Gouty arthritis");
  });
});

describe("RecordChangesQueue", () => {
  it("shows an empty state", () => {
    render(<RecordChangesQueue requests={[]} />);
    expect(screen.getByText(/No record changes are waiting/)).toBeTruthy();
  });

  it("shows patient, current allergy, the ask and the date on each row", () => {
    render(<RecordChangesQueue requests={[VOID_REQUEST, CORRECT_REQUEST]} />);
    expect(screen.getByText(/Ada Obi/)).toBeTruthy();
    expect(screen.getByText(/TH-0042/)).toBeTruthy();
    expect(screen.getByText(/Bayo Ade/)).toBeTruthy();
    expect(screen.getByText(/Remove this allergy/)).toBeTruthy();
    expect(screen.getByText(/Change to: Peanut, Mild/)).toBeTruthy();
    expect(screen.getAllByText(/Asked /)).toHaveLength(2);
  });

  it("opens a request to the current record and the ask side by side, with the reason", () => {
    render(<RecordChangesQueue requests={[CORRECT_REQUEST]} />);
    expect(screen.queryByText("Current record")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));
    expect(screen.getByText("Current record")).toBeTruthy();
    expect(screen.getByText("What the patient asks")).toBeTruthy();
    expect(screen.getByText("It is milder than I wrote")).toBeTruthy();
    expect(screen.getByText("Severe")).toBeTruthy();
    expect(screen.getAllByText("Mild").length).toBeGreaterThan(0);
  });

  it("offers Confirm and Reject, and says the note is internal, for a doctor", () => {
    render(<RecordChangesQueue requests={[VOID_REQUEST]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));
    expect(screen.getByRole("button", { name: /Confirm the change/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Leave the record as it was/ })).toBeTruthy();
    expect(screen.getByText(/the patient never sees this/)).toBeTruthy();
  });

  it("says so, instead of calling the entry gone, when the current record could not be loaded", () => {
    render(<RecordChangesQueue requests={[{ ...VOID_REQUEST, allergy: null, currentUnavailable: true }]} />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/no longer current/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Check the patient/);
  });

  it("says the entry is no longer current when the record loaded but the entry is gone", () => {
    render(<RecordChangesQueue requests={[{ ...VOID_REQUEST, allergy: null, currentUnavailable: false }]} />);
    expect(screen.getByText(/no longer current/)).toBeTruthy();
  });

  it("shows a condition request with the condition as recorded, the ask and the hold wording", () => {
    render(<RecordChangesQueue requests={[CONDITION_CORRECT]} />);
    expect(screen.getByText(/Chidi Eze/)).toBeTruthy();
    expect(screen.getByText("Gout")).toBeTruthy();
    expect(screen.getByText(/Change to: Gouty arthritis/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));
    expect(screen.getByText("Current record")).toBeTruthy();
    expect(screen.getAllByText("M10").length).toBeGreaterThan(0);
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getAllByText("Gouty arthritis").length).toBeGreaterThan(0);
    expect(screen.getByText(/the condition stays on the patient's record/)).toBeTruthy();
    expect(screen.queryByText(/emergency card/)).toBeNull();
    expect(screen.getByRole("button", { name: /Confirm the change/ })).toBeTruthy();
  });

  it("says a condition could not be loaded rather than gone, and no longer current when it loaded but is gone", () => {
    const { unmount } = render(<RecordChangesQueue requests={[{ ...CONDITION_VOID, condition: null, currentUnavailable: true }]} />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/no longer current/)).toBeNull();
    unmount();
    render(<RecordChangesQueue requests={[{ ...CONDITION_VOID, condition: null, currentUnavailable: false }]} />);
    expect(screen.getByText(/no longer current/)).toBeTruthy();
  });

  it("keeps the allergy wording for an allergy request", () => {
    render(<RecordChangesQueue requests={[VOID_REQUEST]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));
    expect(screen.getByText(/emergency card/)).toBeTruthy();
  });
});
