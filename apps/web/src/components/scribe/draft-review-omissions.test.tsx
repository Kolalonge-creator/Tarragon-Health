/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { DraftReviewPanel } from "./draft-review-panel";
import type { ScribeFact } from "@/lib/scribe/facts";

const draft = { history: "Headache for two days.", examination: "", assessment: "Likely tension headache.", plan: "Rest and fluids.", followUp: "Call if worse." };
const useButton = () => screen.getByRole("button", { name: /Use in note/ }) as HTMLButtonElement;
const tickEverything = () => (screen.getAllByRole("checkbox") as HTMLInputElement[]).forEach((b) => fireEvent.click(b));

const fact = (id: string, type: ScribeFact["type"], text: string): ScribeFact => ({ id, type, text, quote: text, speaker: "patient" });
const negation = fact("n1", "negated_symptom", "No chest pain");
const cough = fact("c1", "symptom", "Cough for three days");

function panel(facts?: readonly ScribeFact[], onUse = jest.fn()) {
  return render(<DraftReviewPanel draft={draft} patientSummary="Summary." confirmedFacts={facts} onUse={onUse} onDiscard={jest.fn()} />);
}

describe("DraftReviewPanel: confirmed facts the draft does not say", () => {
  it("shows nothing when no facts are given (the typed-note path is unchanged)", () => {
    panel();
    expect(screen.queryByTestId("omissions")).toBeNull();
  });

  it("shows nothing when the draft says every confirmed fact", () => {
    panel([fact("h", "symptom", "Headache for two days")]);
    expect(screen.queryByTestId("omissions")).toBeNull();
  });

  it("lists a dropped negation as a safety item and blocks use even with every section ticked", () => {
    panel([negation]);
    expect(screen.getByTestId("omissions").textContent).toContain("No chest pain");
    expect(screen.getByText("Safety item")).toBeTruthy();
    tickEverything();
    expect(useButton().disabled).toBe(true);
    expect(screen.getByText(/1 safety item\(s\) missing from the draft still need a decision/)).toBeTruthy();
  });

  it("a negation the draft reversed is still an omission", () => {
    render(<DraftReviewPanel draft={{ ...draft, history: "Chest pain on exertion." }} patientSummary="Summary." confirmedFacts={[negation]} onUse={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getByTestId("omissions")).toBeTruthy();
  });

  it("'Add to note' puts the fact in the note, clears that omission, and un-confirms the section it went into", () => {
    panel([negation]);
    fireEvent.click(screen.getByRole("button", { name: "Add to note" }));
    expect(screen.queryByTestId("omissions")).toBeNull();
    expect((screen.getByLabelText("History") as HTMLTextAreaElement).value).toBe("Headache for two days.\nNo chest pain");
    tickEverything();
    expect(useButton().disabled).toBe(false);
  });

  it("'Leave out on purpose' lets the clinician continue and keeps the decision visible", () => {
    const onUse = jest.fn();
    panel([negation], onUse);
    fireEvent.click(screen.getByRole("button", { name: "Leave out on purpose" }));
    expect(screen.getByText("Left out on purpose")).toBeTruthy();
    tickEverything();
    expect(useButton().disabled).toBe(false);
    fireEvent.click(useButton());
    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it("a missing ordinary fact is listed but never blocks", () => {
    panel([cough]);
    expect(screen.getByTestId("omissions").textContent).toContain("Cough for three days");
    expect(screen.queryByText("Safety item")).toBeNull();
    tickEverything();
    expect(useButton().disabled).toBe(false);
  });

  it("typing the fact into the note by hand resolves it", () => {
    panel([negation]);
    fireEvent.change(screen.getByLabelText("History"), { target: { value: "Headache for two days. Denies chest pain." } });
    expect(screen.queryByTestId("omissions")).toBeNull();
  });

  it("has no accessibility violations with the list showing", async () => {
    const { container } = panel([negation, cough]);
    expect((await axe(container)).violations).toEqual([]);
  });
});
