/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ReadingTriageNote } from "./reading-triage-note";

describe("ReadingTriageNote", () => {
  it("shows nothing for a reading with no result", () => {
    const { container } = render(<ReadingTriageNote result={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the grade in plain words and the approved guidance, with no condition named", () => {
    render(<ReadingTriageNote result={{ id: "a", grade: "amber", explanation_key: "TRI-003", created_at: "2026-10-05T09:00:00Z" }} />);
    expect(screen.getByText("What happened with this reading")).toBeTruthy();
    expect(screen.getByText("Worth another look")).toBeTruthy();
    expect(screen.getByText(/not a diagnosis/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/hypertension|diabetes|high blood pressure/i);
  });

  it("each grade has its own wording", () => {
    const wording = { green: "No action needed", amber: "Worth another look", red: "Needed prompt attention" } as const;
    for (const grade of ["green", "amber", "red"] as const) {
      const { unmount } = render(<ReadingTriageNote result={{ id: grade, grade, explanation_key: null, created_at: "x" }} />);
      expect(screen.getByText(wording[grade])).toBeTruthy();
      unmount();
    }
  });
});
