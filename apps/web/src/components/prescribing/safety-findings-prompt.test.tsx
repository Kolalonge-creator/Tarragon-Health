/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { SafetyFindingsPrompt } from "./safety-findings-prompt";
import type { SafetyError } from "@/lib/prescriptions/parse-safety-error";

function renderPrompt(error: SafetyError, over: Partial<{ confirmed: boolean; reason: string }> = {}) {
  const onConfirm = jest.fn();
  const onReason = jest.fn();
  render(
    <SafetyFindingsPrompt
      error={error}
      idPrefix="t"
      allergiesConfirmed={over.confirmed ?? false}
      onAllergiesConfirmedChange={onConfirm}
      overrideReason={over.reason ?? ""}
      onOverrideReasonChange={onReason}
    />
  );
  return { onConfirm, onReason };
}

describe("SafetyFindingsPrompt", () => {
  it("a controlled medicine shows one plain message and offers no override control at all", () => {
    renderPrompt({ kind: "blocked" });
    expect(screen.getByRole("alert").textContent).toMatch(/TarragonHealth does not prescribe controlled medicines/);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("lists each finding in words, names the allergen, and never pre-ticks the allergy checkbox", () => {
    renderPrompt({
      kind: "findings",
      findings: [{ code: "allergy_match", allergen: "Penicillin" }, { code: "allergies_unrecorded" }, { code: "duplicate_active" }],
    });
    expect(screen.getByText(/recorded allergy to Penicillin/)).toBeTruthy();
    expect(screen.getByText(/allergy list is empty/)).toBeTruthy();
    expect(screen.getByText(/already taking this medicine/)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByLabelText(/Reason for going ahead/)).toBeTruthy();
  });

  it("an empty allergy list alone asks for the confirmation and no reason box", () => {
    renderPrompt({ kind: "findings", findings: [{ code: "allergies_unrecorded" }] });
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.queryByLabelText(/Reason for going ahead/)).toBeNull();
  });

  it("an allergy match alone asks for a reason and no allergy confirmation", () => {
    const { onReason } = renderPrompt({ kind: "findings", findings: [{ code: "allergy_match", allergen: "Penicillin" }] });
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Reason for going ahead/), { target: { value: "Tolerated before" } });
    expect(onReason).toHaveBeenCalledWith("Tolerated before");
  });

  it("ticking the box reports the change", () => {
    const { onConfirm } = renderPrompt({ kind: "findings", findings: [{ code: "allergies_unrecorded" }] });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });
});
