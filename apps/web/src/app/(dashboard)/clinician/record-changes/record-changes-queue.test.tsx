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
  requested_status: "entered_in_error",
  reason: "I never had this reaction",
  replacement: null,
  created_at: "2026-10-12T09:30:00Z",
  patient: { full_name: "Ada Obi", patient_number: "TH-0042" },
  allergy: { allergen: "Peanut", reaction: "Hives", severity: "moderate", source: "patient", noted_at: "2026-01-01" },
};

const CORRECT_REQUEST: RecordChangeRequest = {
  id: "r2",
  requested_status: "corrected",
  reason: "It is milder than I wrote",
  replacement: { allergen: "Peanut", severity: "mild" },
  created_at: "2026-10-13T09:30:00Z",
  patient: { full_name: "Bayo Ade", patient_number: null },
  allergy: { allergen: "Peanut", reaction: null, severity: "severe", source: "patient", noted_at: null },
};

describe("describeRequest", () => {
  it("says remove for a void and names the replacement for a correction", () => {
    expect(describeRequest(VOID_REQUEST)).toMatch(/remove/i);
    expect(describeRequest(CORRECT_REQUEST)).toBe("Change to: Peanut, Mild");
  });
});

describe("RecordChangesQueue", () => {
  it("shows an empty state", () => {
    render(<RecordChangesQueue requests={[]} canDecide />);
    expect(screen.getByText(/No record changes are waiting/)).toBeTruthy();
  });

  it("shows patient, current allergy, the ask and the date on each row", () => {
    render(<RecordChangesQueue requests={[VOID_REQUEST, CORRECT_REQUEST]} canDecide />);
    expect(screen.getByText(/Ada Obi/)).toBeTruthy();
    expect(screen.getByText(/TH-0042/)).toBeTruthy();
    expect(screen.getByText(/Bayo Ade/)).toBeTruthy();
    expect(screen.getByText(/Remove this allergy/)).toBeTruthy();
    expect(screen.getByText(/Change to: Peanut, Mild/)).toBeTruthy();
    expect(screen.getAllByText(/Asked /)).toHaveLength(2);
  });

  it("opens a request to the current record and the ask side by side, with the reason", () => {
    render(<RecordChangesQueue requests={[CORRECT_REQUEST]} canDecide />);
    expect(screen.queryByText("Current record")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));
    expect(screen.getByText("Current record")).toBeTruthy();
    expect(screen.getByText("What the patient asks")).toBeTruthy();
    expect(screen.getByText("It is milder than I wrote")).toBeTruthy();
    expect(screen.getByText("Severe")).toBeTruthy();
    expect(screen.getAllByText("Mild").length).toBeGreaterThan(0);
  });

  it("offers Confirm and Reject, and says the note is internal, for a doctor", () => {
    render(<RecordChangesQueue requests={[VOID_REQUEST]} canDecide />);
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));
    expect(screen.getByRole("button", { name: /Confirm the change/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Leave the record as it was/ })).toBeTruthy();
    expect(screen.getByText(/the patient never sees this/)).toBeTruthy();
  });

  it("offers no decision to someone who cannot decide", () => {
    render(<RecordChangesQueue requests={[VOID_REQUEST]} canDecide={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Open request" }));
    expect(screen.queryByRole("button", { name: /Confirm the change/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Leave the record as it was/ })).toBeNull();
    expect(screen.getByText(/Only a doctor can decide/)).toBeTruthy();
  });
});
