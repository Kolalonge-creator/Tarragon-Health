/** @jest-environment jsdom */
/**
 * S24: the amend form handles the signing safety stops. A SAFETY_FINDINGS stop shows the findings, keeps the button off until the
 * signer has answered, and resubmits with the answers; a SAFETY_BLOCKED stop shows one message with no override control.
 */
import { fireEvent, render, screen } from "@testing-library/react";

const mutate = jest.fn();
let mutationState: { error: unknown; isError: boolean; isPending: boolean } = { error: null, isError: false, isPending: false };

jest.mock("@/lib/queries/medications", () => ({
  useAmendMedication: () => ({ mutate, ...mutationState }),
}));

import { AmendMedicationForm } from "./amend-medication-form";

const MEDICATION = {
  id: "m1",
  organisation_id: "o1",
  drug_name: "Amlodipine",
  dose: "5 mg",
  frequency: "Once daily",
  route: "Oral",
  duration_days: 30,
  quantity: "30 tablets",
  repeats_allowed: 0,
  indication: null,
  instructions: null,
  version: 1,
  rx_number: null,
} as unknown as Parameters<typeof AmendMedicationForm>[0]["medication"];

const findingsError = (findings: unknown[]) => ({ code: "P0001", message: "m", details: "SAFETY_FINDINGS", hint: JSON.stringify(findings) });

function submitWithReason() {
  fireEvent.change(screen.getByLabelText(/Reason for this amendment/), { target: { value: "Dose increased" } });
  fireEvent.click(screen.getByRole("button", { name: /Sign amended version/ }));
}

beforeEach(() => {
  mutate.mockReset();
  mutationState = { error: null, isError: false, isPending: false };
});

describe("AmendMedicationForm safety handling", () => {
  it("first submit sends no allergy confirmation and no override", () => {
    render(<AmendMedicationForm medication={MEDICATION} patientId="p1" onDone={jest.fn()} />);
    submitWithReason();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toMatchObject({ medicationId: "m1", safety: { allergiesConfirmed: false, overrideReason: "" } });
  });

  it("a findings stop shows each finding and disables signing until a reason is given", () => {
    mutationState = { error: findingsError([{ code: "allergy_match", allergen: "Penicillin" }]), isError: true, isPending: false };
    render(<AmendMedicationForm medication={MEDICATION} patientId="p1" onDone={jest.fn()} />);
    expect(screen.getByText(/recorded allergy to Penicillin/)).toBeTruthy();
    const button = screen.getByRole("button", { name: /Sign amended version/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason for going ahead/), { target: { value: "Tolerated before, patient informed" } });
    expect(button.disabled).toBe(false);
  });

  it("an empty allergy list needs the checkbox, never pre-ticked, and resubmits with it", () => {
    mutationState = { error: findingsError([{ code: "allergies_unrecorded" }]), isError: true, isPending: false };
    render(<AmendMedicationForm medication={MEDICATION} patientId="p1" onDone={jest.fn()} />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    const button = screen.getByRole("button", { name: /Sign amended version/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(box);
    expect(button.disabled).toBe(false);
    submitWithReason();
    expect(mutate.mock.calls[0]![0]).toMatchObject({ safety: { allergiesConfirmed: true } });
  });

  it("a controlled medicine shows one message and no override control, and signing stays off", () => {
    mutationState = { error: { code: "P0001", message: "m", details: "SAFETY_BLOCKED", hint: "[]" }, isError: true, isPending: false };
    render(<AmendMedicationForm medication={MEDICATION} patientId="p1" onDone={jest.fn()} />);
    expect(screen.getByRole("alert").textContent).toMatch(/does not prescribe controlled medicines/);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText(/Reason for going ahead/)).toBeNull();
    expect((screen.getByRole("button", { name: /Sign amended version/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("any other failure still shows its own message and does not open the override", () => {
    mutationState = { error: new Error("Not authorised to amend this prescription"), isError: true, isPending: false };
    render(<AmendMedicationForm medication={MEDICATION} patientId="p1" onDone={jest.fn()} />);
    expect(screen.getByText(/Not authorised to amend this prescription/)).toBeTruthy();
    expect(screen.queryByLabelText(/Reason for going ahead/)).toBeNull();
  });
});
