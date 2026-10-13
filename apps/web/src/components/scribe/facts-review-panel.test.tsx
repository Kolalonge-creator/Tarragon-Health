/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { FactsReviewPanel } from "./facts-review-panel";
import type { ScribeFact } from "@/lib/scribe/facts";

const facts: ScribeFact[] = [
  { id: "f1", type: "symptom", text: "Headaches for two weeks.", quote: "headaches for two weeks", speaker: "patient" },
  { id: "f2", type: "negated_symptom", text: "No chest pain.", quote: "No chest pain", speaker: "patient" },
];
const writeBtn = () => screen.getByRole("button", { name: /Write the draft/ }) as HTMLButtonElement;

describe("FactsReviewPanel", () => {
  it("lists negations first, shows each quote, and has no confirm-all", () => {
    render(<FactsReviewPanel facts={facts} dropped={0} onWrite={jest.fn()} onBack={jest.fn()} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]?.textContent).toMatch(/Does NOT have/);
    expect(screen.getByText("No chest pain")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirm all/i })).toBeNull();
  });

  it("cannot write until every fact is decided, then passes only the confirmed ones", () => {
    const onWrite = jest.fn();
    render(<FactsReviewPanel facts={facts} dropped={0} onWrite={onWrite} onBack={jest.fn()} />);
    expect(writeBtn().disabled).toBe(true);
    expect(screen.getByText(/2 facts still to decide/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Confirm" })[0]!); // the negation (listed first)
    expect(writeBtn().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reject" })); // the one fact still undecided
    expect(writeBtn().disabled).toBe(false);
    fireEvent.click(writeBtn());
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(onWrite.mock.calls[0]![0].map((f: ScribeFact) => f.id)).toEqual(["f2"]);
  });

  it("a fact the clinician adds counts as confirmed", () => {
    const onWrite = jest.fn();
    render(<FactsReviewPanel facts={[]} dropped={2} onWrite={onWrite} onBack={jest.fn()} />);
    expect(screen.getByText(/No facts could be found/)).toBeTruthy();
    expect(screen.getByText(/2 items the AI listed were removed/)).toBeTruthy();
    expect(writeBtn().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What was said"), { target: { value: "Allergic to penicillin." } });
    fireEvent.click(screen.getByRole("button", { name: "Add this fact" }));
    expect(writeBtn().disabled).toBe(false);
    fireEvent.click(writeBtn());
    expect(onWrite.mock.calls[0]![0][0]).toMatchObject({ text: "Allergic to penicillin.", quote: "" });
  });

  it("a corrected wording is what goes on", () => {
    const onWrite = jest.fn();
    render(<FactsReviewPanel facts={[facts[0]!]} dropped={0} onWrite={onWrite} onBack={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Correct the wording"), { target: { value: "Headaches for three weeks." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    fireEvent.click(writeBtn());
    expect(onWrite.mock.calls[0]![0][0].text).toBe("Headaches for three weeks.");
  });
});
