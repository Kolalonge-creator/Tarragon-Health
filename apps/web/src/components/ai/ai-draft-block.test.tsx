/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { AiDraftBlock } from "./ai-draft-block";

const TEXT = "Headache for two days. Advised rest.";
const signButton = () => screen.getByRole("button", { name: "Sign" }) as HTMLButtonElement;
const accepts = () => screen.getAllByRole("button", { name: "Accept" });

describe("AiDraftBlock", () => {
  it("carries the AI label and marks every span as unreviewed", () => {
    render(<AiDraftBlock initialText={TEXT} onSign={jest.fn()} />);
    expect(screen.getByTestId("ai-label").textContent).toContain("AI-drafted, not yet reviewed");
    expect(document.querySelectorAll('[data-span-status="unreviewed"]')).toHaveLength(2);
  });

  it("Sign stays disabled while a span is unreviewed, even with the attestation ticked", () => {
    render(<AiDraftBlock initialText={TEXT} onSign={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/I reviewed this draft against the record/));
    fireEvent.click(accepts()[0]!);
    expect(signButton().disabled).toBe(true);
    expect(screen.getByText(/1 sentence still to review/)).toBeTruthy();
  });

  it("Sign stays disabled without the attestation, even when every span is reviewed", () => {
    render(<AiDraftBlock initialText={TEXT} onSign={jest.fn()} />);
    fireEvent.click(accepts()[0]!);
    fireEvent.click(accepts()[0]!);
    expect(signButton().disabled).toBe(true);
  });

  it("signs once every span is reviewed and attested, handing over the text and the edit-rate figures", () => {
    const onSign = jest.fn();
    render(<AiDraftBlock initialText={TEXT} onSign={onSign} />);
    fireEvent.click(accepts()[0]!);
    fireEvent.click(accepts()[0]!);
    fireEvent.click(screen.getByLabelText(/I reviewed this draft against the record/));
    expect(signButton().disabled).toBe(false);
    fireEvent.click(signButton());
    expect(onSign).toHaveBeenCalledWith(expect.objectContaining({ text: TEXT, attested: true, telemetry: expect.objectContaining({ leftUnedited: true, editRate: 0 }) }));
  });

  it("an edit reports a non-zero edit rate and clears a prior attestation", () => {
    const onSign = jest.fn();
    const onTelemetry = jest.fn();
    render(<AiDraftBlock initialText={TEXT} onSign={onSign} onTelemetry={onTelemetry} />);
    fireEvent.click(accepts()[1]!);
    fireEvent.click(screen.getByLabelText(/I reviewed this draft against the record/));
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    fireEvent.change(screen.getByLabelText("Edit this sentence"), { target: { value: "Headache for three days." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((screen.getByLabelText(/I reviewed this draft against the record/) as HTMLInputElement).checked).toBe(false);
    expect(signButton().disabled).toBe(true);
    const last = onTelemetry.mock.calls.at(-1)![0];
    expect(last.leftUnedited).toBe(false);
    expect(last.editRate).toBeGreaterThan(0);
  });

  it("without onSign it is a review block only: no sign button and no attestation", () => {
    render(<AiDraftBlock initialText={TEXT} />);
    expect(screen.queryByRole("button", { name: "Sign" })).toBeNull();
    expect(screen.queryByLabelText(/I reviewed this draft/)).toBeNull();
  });
});
