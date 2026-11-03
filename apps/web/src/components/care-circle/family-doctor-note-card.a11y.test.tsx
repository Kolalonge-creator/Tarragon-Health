/** @jest-environment jsdom */
/**
 * The doctor's line for the family (2026-11-03): the note in readable type, the date, and the doctor's name ONLY when the database sent
 * both the author's id and name (null-gated, never invented); otherwise "your care team". An empty state when nothing is written yet.
 * Axe-clean in every state.
 */
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { FamilyDoctorNoteCard, FamilyNoteAttribution } from "./family-doctor-note-card";

const NOTE = {
  body: "Your mum did well today. Please help her keep walking each evening.",
  written_at: "2026-11-03T10:00:00Z",
  author_staff_id: "0e4714d4-b20f-40a2-96d4-de0630748fff",
  author_name: "Dr Amara Eze",
};

describe("FamilyDoctorNoteCard", () => {
  it("shows the note, the doctor's name and the date, axe-clean", async () => {
    await expectNoA11yViolations(<FamilyDoctorNoteCard note={NOTE} locale="en" />);
    expect(screen.getByRole("heading", { name: "A note from the doctor" })).toBeTruthy();
    expect(screen.getByText(NOTE.body)).toBeTruthy();
    expect(screen.getByText("From Dr Amara Eze")).toBeTruthy();
    expect(screen.getByText(/^Written /).closest("time")?.getAttribute("datetime")).toBe(NOTE.written_at);
  });

  it("null-gated: no author id or no name means 'your care team', never a guessed name", async () => {
    await expectNoA11yViolations(<FamilyDoctorNoteCard note={{ ...NOTE, author_staff_id: null, author_name: null }} locale="en" />);
    expect(screen.getByText("From your care team")).toBeTruthy();
    expect(screen.queryByText(/Amara/)).toBeNull();
  });

  it("a name without the staff id is not trusted either", () => {
    render(<FamilyNoteAttribution note={{ ...NOTE, author_staff_id: null }} locale="en" />);
    expect(screen.getByText("From your care team")).toBeTruthy();
  });

  it("shows a calm empty state when no note has been written yet", async () => {
    await expectNoA11yViolations(<FamilyDoctorNoteCard note={null} locale="en" />);
    expect(screen.getByText(/No note yet/)).toBeTruthy();
    expect(screen.queryByText(/^From /)).toBeNull();
  });

  it("has no em dash anywhere", () => {
    const { container } = render(<FamilyDoctorNoteCard note={NOTE} locale="en" />);
    expect(container.textContent).not.toContain("—");
  });
});
