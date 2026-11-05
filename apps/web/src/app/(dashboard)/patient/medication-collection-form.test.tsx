/** @jest-environment jsdom */
/**
 * T2-11c: for a signed prescription "I've got this medicine" records a patient-reported supply through the database function (never
 * a direct table insert); for a medicine the patient added themselves the old "I picked this up" insert is unchanged.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const confirmMutate = jest.fn();
const undoMutate = jest.fn();
const insert = jest.fn().mockResolvedValue({ error: null });

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ insert }) }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: (opts: { mutationFn: () => Promise<unknown>; onSuccess?: () => void }) => ({
    mutate: async () => {
      await opts.mutationFn();
      opts.onSuccess?.();
    },
    isPending: false,
    isError: false,
  }),
}));
jest.mock("@/lib/queries/medications", () => ({
  todayIsoDate: () => "2026-11-05",
  useConfirmPrescriptionCollected: () => ({ mutate: confirmMutate, isPending: false, isError: false }),
  useUndoPrescriptionCollected: () => ({ mutate: undoMutate, isPending: false, isError: false }),
}));

import { MedicationCollectionForm, isSignedPrescription } from "./medication-collection-form";
import type { Medication } from "@/lib/queries/medications";

const SIGNED = {
  id: "m1",
  organisation_id: "o1",
  drug_name: "Amlodipine",
  source: "clinician",
  rx_number: "TRG-RX-1",
  superseded_at: null,
  is_active: true,
} as unknown as Medication;

beforeEach(() => {
  confirmMutate.mockReset();
  insert.mockClear();
});

describe("MedicationCollectionForm (T2-11c)", () => {
  it("knows a signed prescription", () => {
    expect(isSignedPrescription(SIGNED)).toBe(true);
    expect(isSignedPrescription({ ...SIGNED, rx_number: null })).toBe(false);
    expect(isSignedPrescription({ ...SIGNED, source: "patient" })).toBe(false);
    expect(isSignedPrescription({ ...SIGNED, superseded_at: "2026-11-01" })).toBe(false);
  });

  it("records a signed prescription through confirm_prescription_collected and says so plainly", async () => {
    confirmMutate.mockImplementation((_input, { onSuccess }) => onSuccess({ outcome: "recorded", dispenseId: "d1" }));
    render(<MedicationCollectionForm medication={SIGNED} patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "I've got this medicine" }));
    expect(screen.getByText(/as reported by you/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Pharmacy (optional)"), { target: { value: "Corner Chemist" } });
    fireEvent.change(screen.getByLabelText("Town (optional)"), { target: { value: "Ikeja" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm I have it" }));
    expect(confirmMutate).toHaveBeenCalledWith(
      { medicationId: "m1", collectedOn: "2026-11-05", pharmacyName: "Corner Chemist", pharmacyTown: "Ikeja" },
      expect.any(Object)
    );
    expect(insert).not.toHaveBeenCalled();
    expect((await screen.findByRole("status")).textContent).toMatch(/undo this for 24 hours/);
    // T2-11d: whoever recorded it (a caregiver cannot read the supply list) can undo the row just recorded
    fireEvent.click(screen.getByRole("button", { name: "Undo, this was a mistake" }));
    expect(undoMutate).toHaveBeenCalledWith({ dispenseId: "d1" }, expect.any(Object));
  });

  it("shows a refusal from the database without closing the form", () => {
    confirmMutate.mockImplementation((_input, { onSuccess }) => onSuccess({ outcome: "no_supply_available", dispenseId: null }));
    render(<MedicationCollectionForm medication={SIGNED} patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "I've got this medicine" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm I have it" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Every supply on this prescription is already recorded/);
    expect(screen.getByRole("button", { name: "Confirm I have it" })).toBeTruthy();
  });

  it("keeps the old insert for a medicine the patient added", async () => {
    render(<MedicationCollectionForm medication={{ ...SIGNED, source: "patient", rx_number: null } as Medication} patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "I picked this up" }));
    expect(screen.queryByLabelText("Town (optional)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(insert).toHaveBeenCalledWith(expect.objectContaining({ source: "patient", medication_id: "m1" })));
    expect(confirmMutate).not.toHaveBeenCalled();
  });
});
