/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockMutate = jest.fn();
const mockRaise = jest.fn();
jest.mock("@/lib/queries/medication-reconciliations", () => ({
  useOpenMedicationReconciliation: () => ({ data: { id: "r1", patient_confirmed_at: null } }),
  useConfirmMedicationList: () => ({ mutate: mockMutate, isPending: false, isError: false, isSuccess: false }),
}));
jest.mock("./medication-not-sure-actions", () => ({ raiseMedicationNotSureTask: (i: unknown) => mockRaise(i) }));

import { MedicationReconciliationConfirm } from "./medication-reconciliation-confirm";

describe("medication list confirmation: I'm not sure (P16)", () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockRaise.mockReset();
  });

  it("raises the routine task, leaves the list unconfirmed and shows the signed wording", async () => {
    mockRaise.mockResolvedValue({ ok: true, alreadyRaisedToday: false });
    render(<MedicationReconciliationConfirm patientId="p1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I'm not sure" }));
    });
    expect(mockRaise).toHaveBeenCalledWith({ source: "reconciliation" });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/stays unconfirmed/);
  });

  it("shows an error, not the reassurance, when the task cannot be raised", async () => {
    mockRaise.mockResolvedValue({
      ok: false,
      error: "This can only be sent from their own account, so it reaches their care team as their answer.",
    });
    render(<MedicationReconciliationConfirm patientId="p1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I'm not sure" }));
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/own account/);
  });

  it("still confirms when the patient says the list is accurate", () => {
    render(<MedicationReconciliationConfirm patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm this list is accurate" }));
    expect(mockMutate).toHaveBeenCalledWith({ existingId: "r1", note: null });
  });
});
