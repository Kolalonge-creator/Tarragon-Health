/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DraftReviewPanel } from "./draft-review-panel";

const SOURCE = "Headache for two days, worse in the mornings.\nNo vomiting. Temperature 37.2 today.";
const draft = {
  history: "Headache for two days, worse in the morning. Long history of asthma treated with a salbutamol inhaler.",
  examination: "",
  assessment: "",
  plan: "",
  followUp: "",
};
const useButton = () => screen.getByRole("button", { name: /Use in note/ }) as HTMLButtonElement;
const confirmAll = () =>
  (screen.getAllByRole("checkbox") as HTMLInputElement[]).forEach((b) => {
    if (!b.disabled && !b.checked) fireEvent.click(b);
  });

describe("DraftReviewPanel with the visit text", () => {
  it("shows the visit text beside the draft and marks the sentence nobody said", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="" sourceText={SOURCE} onUse={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getByTestId("visit-text").textContent).toContain("No vomiting");
    const flagged = screen.getAllByTestId("unsupported-sentence");
    expect(flagged).toHaveLength(1);
    expect(flagged[0].textContent).toContain("Not said in the visit");
    expect(flagged[0].textContent).toContain("asthma");
  });

  it("cannot be used until the flagged sentence is kept on purpose or removed", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="" sourceText={SOURCE} onUse={jest.fn()} onDiscard={jest.fn()} />);
    confirmAll();
    expect(useButton().disabled).toBe(true);
    expect(screen.getByText(/1 sentence\(s\) not said in the visit still need a decision/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep, I checked it" }));
    confirmAll();
    expect(useButton().disabled).toBe(false);
  });

  it("removing the sentence takes it out of the text that is used", () => {
    const onUse = jest.fn();
    render(<DraftReviewPanel draft={draft} patientSummary="" sourceText={SOURCE} onUse={onUse} onDiscard={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove sentence" }));
    expect(screen.queryAllByTestId("unsupported-sentence")).toHaveLength(0);
    confirmAll();
    fireEvent.click(useButton());
    const used = onUse.mock.calls[0][0] as { history: string };
    expect(used.history).not.toContain("asthma");
    expect(used.history).toContain("Headache for two days");
  });

  it("a section with an unresolved sentence cannot be confirmed", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="" sourceText={SOURCE} onUse={jest.fn()} onDiscard={jest.fn()} />);
    const first = (screen.getAllByRole("checkbox") as HTMLInputElement[])[0];
    expect(first.disabled).toBe(true);
  });

  it("rejecting a section empties it and counts it as decided", () => {
    const onUse = jest.fn();
    render(<DraftReviewPanel draft={{ ...draft, history: "Headache for two days." }} patientSummary="" sourceText={SOURCE} onUse={onUse} onDiscard={jest.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Reject this section" })[0]);
    confirmAll();
    fireEvent.click(useButton());
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ history: "" }), "");
  });

  it("every draft carries the AI-drafted, unsigned watermark", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="" sourceText={SOURCE} onUse={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.getByTestId("watermark").textContent).toBe("AI-drafted, unsigned");
  });

  it("without visit text nothing is flagged and the old rules apply", () => {
    render(<DraftReviewPanel draft={draft} patientSummary="" onUse={jest.fn()} onDiscard={jest.fn()} />);
    expect(screen.queryByTestId("visit-text")).toBeNull();
    expect(screen.queryAllByTestId("unsupported-sentence")).toHaveLength(0);
  });
});

describe("Report a problem with this draft", () => {
  it("offers the five fixed categories and sends the chosen one", async () => {
    const onReport = jest.fn(async () => true);
    render(<DraftReviewPanel draft={draft} patientSummary="" onReport={onReport} onUse={jest.fn()} onDiscard={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Report a problem with this draft" }));
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    const send = screen.getByRole("button", { name: "Send report" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Wrong medicine or dose/));
    expect(screen.getByRole("alert").textContent).toContain("Do not use this draft");
    fireEvent.click(send);
    await waitFor(() => expect(onReport).toHaveBeenCalledWith({ category: "wrong_medicine_or_dose", section: null, comment: "" }));
    await screen.findByText(/The report was recorded/);
  });

  it("says so when the report could not be recorded", async () => {
    render(<DraftReviewPanel draft={draft} patientSummary="" onReport={async () => false} onUse={jest.fn()} onDiscard={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Report a problem with this draft" }));
    fireEvent.click(screen.getByLabelText(/^Other/));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText(/could not be recorded/);
  });
});
