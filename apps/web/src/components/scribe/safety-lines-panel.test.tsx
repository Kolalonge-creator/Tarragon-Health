/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { SafetyLinesPanel } from "./safety-lines-panel";

describe("SafetyLinesPanel (S64, 15.4)", () => {
  const lines = [
    { kind: "allergy" as const, section: "history", text: "Allergic to penicillin." },
    { kind: "medicine" as const, section: "plan", text: "Amlodipine 5 mg daily." },
  ];

  it("lists every allergy and medicine line and asks for one explicit confirmation", () => {
    const onChange = jest.fn();
    render(<SafetyLinesPanel lines={lines} confirmed={false} onConfirmedChange={onChange} />);
    expect(screen.getByText("Allergic to penicillin.")).toBeTruthy();
    expect(screen.getByText("Amlodipine 5 mg daily.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Confirm the allergy and medicine lines before you sign.");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows allergy lines before medicine lines", () => {
    render(<SafetyLinesPanel lines={lines} confirmed onConfirmedChange={() => undefined} />);
    expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("data-kind"))).toEqual(["allergy", "medicine"]);
  });

  it("still asks for the confirmation when no such lines were found, and says nothing was found", () => {
    render(<SafetyLinesPanel lines={[]} confirmed={false} onConfirmedChange={() => undefined} />);
    expect(screen.getByText(/No allergy or medicine lines were found in the draft/)).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it("drops the reminder once confirmed", () => {
    render(<SafetyLinesPanel lines={lines} confirmed onConfirmedChange={() => undefined} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
