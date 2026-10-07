/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ClinicianIntakePanel } from "./clinician-intake-panel";

describe("ClinicianIntakePanel (S64, 15.3)", () => {
  it("shows what the patient sent, labelled as the patient's words and not a diagnosis", () => {
    render(<ClinicianIntakePanel intake={{ id: "i", source: "manual", summary: "Reason for the visit: Headaches\nFor how long: a few days", sent_at: "2026-10-07T10:00:00Z" }} />);
    expect(screen.getByText(/Reason for the visit: Headaches/)).toBeTruthy();
    expect(screen.getByText("Written by the patient. It is not a diagnosis.")).toBeTruthy();
  });

  it("says plainly when nothing was sent", () => {
    render(<ClinicianIntakePanel intake={null} />);
    expect(screen.getByText("The patient has not sent anything before this visit.")).toBeTruthy();
  });
});
