/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
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
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ plan: "Rest and fluids." }), "Summary.", expect.objectContaining({ leftUnedited: true }));
  });

  it("editing a confirmed section clears its confirmation and asks again", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={jest.fn()} onDiscard={jest.fn()} />);
    boxes().forEach((b) => fireEvent.click(b));
    fireEvent.change(screen.getAllByRole("textbox")[3], { target: { value: "Rest, fluids and paracetamol." } });
    expect(useButton().disabled).toBe(true);
    expect(screen.getByText(/please confirm it again/)).toBeTruthy();
  });

  it("marks every drug name and number in a section so the clinician checks them against what was said (Q19)", () => {
    render(<DraftReviewPanel draft={{ ...draft, plan: "Start amlodipine 5 mg once daily. BP 150/90, review in 2 weeks." }} patientSummary="Summary." onUse={jest.fn()} onDiscard={jest.fn()} />);
    const box = screen.getByTestId("entity-check");
    expect(box.textContent).toContain("Check each one against what was said");
    const marked = Array.from(box.querySelectorAll("mark")).map((m) => `${m.getAttribute("data-kind")}:${m.textContent}`);
    expect(marked).toEqual(["drug:amlodipine", "number:5 mg", "number:150/90", "number:2 weeks"]);
  });

  it("shows no check box for a section with no drug names or numbers, and the highlight never changes the text that is used", () => {
    const onUse = jest.fn();
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={onUse} onDiscard={jest.fn()} />);
    expect(screen.queryByTestId("entity-check")).toBeNull();
    boxes().forEach((b) => fireEvent.click(b));
    fireEvent.click(useButton());
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ plan: "Rest and fluids." }), "Summary.", expect.objectContaining({ leftUnedited: true }));
  });

  it("updates the marks when the clinician edits the section", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={jest.fn()} onDiscard={jest.fn()} />);
    fireEvent.change(screen.getAllByRole("textbox")[3], { target: { value: "Paracetamol 1 g three times daily" } });
    const marked = Array.from(screen.getByTestId("entity-check").querySelectorAll("mark")).map((m) => m.textContent);
    expect(marked).toEqual(["Paracetamol", "1 g"]);
  });

  it("S89: cannot be used without the attestation, even with every section confirmed (and editing clears it)", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={jest.fn()} onDiscard={jest.fn()} />);
    const sections = boxes().slice(0, 6);
    sections.forEach((b) => fireEvent.click(b));
    expect(useButton().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I reviewed this draft against the record/));
    expect(useButton().disabled).toBe(false);
    fireEvent.change(screen.getAllByRole("textbox")[3], { target: { value: "Rest." } });
    expect(useButton().disabled).toBe(true);
  });

  it("S89: carries the AI label and reports a non-zero edit rate when the clinician changed the draft", () => {
    const onUse = jest.fn();
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={onUse} onDiscard={jest.fn()} />);
    expect(screen.getByTestId("ai-label")).toBeTruthy();
    fireEvent.change(screen.getAllByRole("textbox")[3], { target: { value: "Rest, fluids and review." } });
    boxes().forEach((b) => fireEvent.click(b));
    fireEvent.click(useButton());
    expect(onUse.mock.calls[0]![2]).toMatchObject({ leftUnedited: false });
    expect(onUse.mock.calls[0]![2].editRate).toBeGreaterThan(0);
  });

  it("S89: every section state is a word, not only a colour, and each box is labelled by its section name", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={jest.fn()} onDiscard={jest.fn()} />);
    const states = () => Array.from(document.querySelectorAll("[data-section-state]")).map((e) => e.textContent);
    expect(states()).toEqual(["AI text, not reviewed", "Empty, not yet confirmed", "AI text, not reviewed", "AI text, not reviewed", "AI text, not reviewed", "AI text, not reviewed"]);
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
    for (const box of screen.getAllByRole("textbox")) expect((box as HTMLTextAreaElement).labels?.length).toBe(1);
    fireEvent.change(screen.getAllByRole("textbox")[3], { target: { value: "Rest only." } });
    expect(states()[3]).toBe("Edited, not yet confirmed");
    fireEvent.click(boxes()[0]!);
    expect(states()[0]).toBe("Confirmed");
  });

  it("S89: has no axe violations", async () => {
    const { container } = render(<DraftReviewPanel draft={draft} patientSummary="Summary." onUse={jest.fn()} onDiscard={jest.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
