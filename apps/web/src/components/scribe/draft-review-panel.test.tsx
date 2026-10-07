/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { DraftReviewPanel } from "./draft-review-panel";

const draft = { history: "Headache for two days.", examination: "", assessment: "Likely tension headache.", plan: "Rest and fluids.", followUp: "Call if worse." };
const useButton = () => screen.getByRole("button", { name: /Use in note/ }) as HTMLButtonElement;
const boxes = () => screen.getAllByRole("checkbox") as HTMLInputElement[];

describe("DraftReviewPanel review step", () => {
  it("cannot be used until every section is confirmed", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={jest.fn()} onDiscard={jest.fn()} />);
    expect(useButton().disabled).toBe(true);
    expect(screen.getByText(/6 sections still to confirm/)).toBeTruthy();
  });

  it("flags the empty section as a possible omission and words its confirmation differently", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getAllByText(/something may have been missed/)).toHaveLength(1);
    expect(screen.getByLabelText(/Nothing was discussed about this/)).toBeTruthy();
  });

  it("enables use once all are confirmed, and passes the text on", () => {
    const onUse = jest.fn();
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={onUse} onDiscard={jest.fn()} />);
    boxes().forEach((b) => fireEvent.click(b));
    expect(useButton().disabled).toBe(false);
    fireEvent.click(useButton());
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ plan: "Rest and fluids." }), "Summary.");
  });

  it("editing a confirmed section clears its confirmation and asks again", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={jest.fn()} onDiscard={jest.fn()} />);
    boxes().forEach((b) => fireEvent.click(b));
    fireEvent.change(screen.getAllByRole("textbox")[3], { target: { value: "Rest, fluids and paracetamol." } });
    expect(useButton().disabled).toBe(true);
    expect(screen.getByText(/please confirm it again/)).toBeTruthy();
  });
});
