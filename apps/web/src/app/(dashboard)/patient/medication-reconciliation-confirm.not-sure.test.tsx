/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";

const mockMutate = jest.fn();
jest.mock("@/lib/queries/medication-reconciliations", () => ({
  useOpenMedicationReconciliation: () => ({ data: { id: "r1", patient_confirmed_at: null } }),
  useConfirmMedicationList: () => ({ mutate: mockMutate, isPending: false, isError: false, isSuccess: false }),
}));

import { MedicationReconciliationConfirm } from "./medication-reconciliation-confirm";

describe("medication list confirmation: I'm not sure (P16)", () => {
  beforeEach(() => mockMutate.mockClear());

  it("leaves the list unconfirmed and says what to do next", () => {
    render(<MedicationReconciliationConfirm patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "I'm not sure" }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/stays unconfirmed/);
  });

  it("still confirms when the patient says the list is accurate", () => {
    render(<MedicationReconciliationConfirm patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm this list is accurate" }));
    expect(mockMutate).toHaveBeenCalledWith({ existingId: "r1", note: null });
  });
});
