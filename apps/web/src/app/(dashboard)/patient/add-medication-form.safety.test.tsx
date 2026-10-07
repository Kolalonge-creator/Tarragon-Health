/** @jest-environment jsdom */
/**
 * S24: the clinician prescribe flow. After "Sign & prescribe" a signing safety stop shows the findings in the review step and the
 * form resubmits with the signer's answers; a controlled medicine shows one message with no override control. Never fails open.
 */
import { fireEvent, render, screen } from "@testing-library/react";

const mutate = jest.fn();
const reset = jest.fn();
let mutationState: { error: unknown; isError: boolean; isPending: boolean } = { error: null, isError: false, isPending: false };

jest.mock("@/lib/queries/medications", () => ({
  useAddMedication: () => ({ mutate, reset, ...mutationState }),
  useMedications: () => ({ data: undefined }),
}));
jest.mock("@/lib/queries/medicine-catalogue", () => ({
  useInteractionCheckOpen: () => ({ data: false, isPending: false, isError: false }),
  useMedicineCatalogue: () => ({ data: [], isPending: false, isError: false }),
}));
jest.mock("@/lib/medications/pack-actions", () => ({ checkMedicationPack: jest.fn() }));
jest.mock("./actions", () => ({ checkMedicationSafetyAfterAdd: jest.fn().mockResolvedValue({ allergyCheckSkipped: false }) }));

import { AddMedicationForm } from "./add-medication-form";

const findingsError = (findings: unknown[]) => ({ code: "P0001", message: "m", details: "SAFETY_FINDINGS", hint: JSON.stringify(findings) });

function goToReview() {
  fireEvent.change(screen.getByLabelText("Drug name"), { target: { value: "Amoxicillin" } });
  fireEvent.change(screen.getByLabelText(/Duration \(days\)/), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: "21 capsules" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue to review/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /reviewed the safety notes/i }));
}

beforeEach(() => {
  mutate.mockReset();
  reset.mockReset();
  mutationState = { error: null, isError: false, isPending: false };
});

describe("AddMedicationForm (clinician) signing safety", () => {
  it("the first sign sends no allergy confirmation and no override", () => {
    render(<AddMedicationForm patientId="p1" source="clinician" />);
    goToReview();
    fireEvent.click(screen.getByRole("button", { name: /Sign & prescribe/ }));
    expect(mutate.mock.calls[0]![0]).toMatchObject({ source: "clinician", safety: { allergiesConfirmed: false, overrideReason: "" } });
  });

  it("a findings stop is shown in the review step and signing waits for the answers", () => {
    mutationState = {
      error: findingsError([{ code: "allergy_match", allergen: "Penicillin" }, { code: "duplicate_active" }]),
      isError: true,
      isPending: false,
    };
    render(<AddMedicationForm patientId="p1" source="clinician" />);
    goToReview();
    expect(screen.getByText(/recorded allergy to Penicillin/)).toBeTruthy();
    expect(screen.getByText(/already taking this medicine/)).toBeTruthy();
    const sign = screen.getByRole("button", { name: /Sign & prescribe/ }) as HTMLButtonElement;
    expect(sign.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason for going ahead/), { target: { value: "Benefit outweighs risk, discussed" } });
    expect(sign.disabled).toBe(false);
    fireEvent.click(sign);
    expect(mutate.mock.calls[0]![0]).toMatchObject({ safety: { overrideReason: "Benefit outweighs risk, discussed" } });
  });

  it("an empty allergy list shows an unticked checkbox", () => {
    mutationState = { error: findingsError([{ code: "allergies_unrecorded" }]), isError: true, isPending: false };
    render(<AddMedicationForm patientId="p1" source="clinician" />);
    goToReview();
    const box = screen.getByRole("checkbox", { name: /checked the allergy list/i }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect((screen.getByRole("button", { name: /Sign & prescribe/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box);
    expect((screen.getByRole("button", { name: /Sign & prescribe/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a controlled medicine shows one message, no override control, and signing cannot be pressed", () => {
    mutationState = { error: { code: "P0001", message: "m", details: "SAFETY_BLOCKED", hint: "[]" }, isError: true, isPending: false };
    render(<AddMedicationForm patientId="p1" source="clinician" />);
    goToReview();
    expect(screen.getByText(/does not prescribe controlled medicines/)).toBeTruthy();
    expect(screen.queryByLabelText(/Reason for going ahead/)).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /checked the allergy list/i })).toBeNull();
    expect((screen.getByRole("button", { name: /Sign & prescribe/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("going back clears the stale stop so it cannot leak into the next attempt", () => {
    mutationState = { error: findingsError([{ code: "duplicate_active" }]), isError: true, isPending: false };
    render(<AddMedicationForm patientId="p1" source="clinician" />);
    goToReview();
    fireEvent.click(screen.getByRole("button", { name: /Back to edit/ }));
    expect(reset).toHaveBeenCalled();
  });

  it("an unrelated failure shows the generic sentence and does not open the override", () => {
    mutationState = { error: new Error("boom"), isError: true, isPending: false };
    render(<AddMedicationForm patientId="p1" source="clinician" />);
    goToReview();
    expect(screen.getByText(/could not save this medication/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Reason for going ahead/)).toBeNull();
  });
});
