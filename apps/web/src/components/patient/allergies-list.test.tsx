/** @jest-environment jsdom */
/**
 * S05b-e: a patient with a waiting request sees one plain line on that allergy and can withdraw it; an allergy with no
 * request shows neither. The words are plain English with no dash used as punctuation.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mutateAsync = jest.fn();
let allergies: Array<Record<string, unknown>> = [];
let pending: Array<{ id: string; allergy_id: string }> = [];

jest.mock("@/lib/queries/allergies", () => ({
  useAllergies: () => ({ data: allergies, isLoading: false }),
  useAddAllergy: () => ({ mutateAsync: jest.fn(), isPending: false }),
  usePendingAllergyRequests: () => ({ data: pending }),
  useWithdrawAllergyRequest: () => ({ mutateAsync, isPending: false }),
}));
jest.mock("@/components/result-explainer", () => ({ ResultExplainer: () => null }));

import { AllergiesList } from "./allergies-list";

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mutateAsync.mockReset();
  allergies = [
    { id: "a1", allergen: "Peanut", reaction: null, severity: "mild", source: "patient" },
    { id: "a2", allergen: "Latex", reaction: null, severity: null, source: "patient" },
  ];
  pending = [{ id: "req-1", allergy_id: "a1" }];
});

describe("AllergiesList pending change", () => {
  it("shows the status line only on the allergy with a waiting request", () => {
    render(<AllergiesList patientId={PATIENT_ID} />);
    const lines = screen.getAllByText("Change requested, waiting for your care team");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).not.toMatch(/[–—]/);
    expect(screen.getAllByRole("button", { name: "Withdraw request" })).toHaveLength(1);
  });

  it("shows nothing when no request is waiting", () => {
    pending = [];
    render(<AllergiesList patientId={PATIENT_ID} />);
    expect(screen.queryByText(/waiting for your care team/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw request" })).toBeNull();
  });

  it("withdraws the right request", async () => {
    mutateAsync.mockResolvedValue(undefined);
    render(<AllergiesList patientId={PATIENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ patientId: PATIENT_ID, requestId: "req-1" }));
  });

  it("shows a failure instead of hiding it", async () => {
    mutateAsync.mockRejectedValue(new Error("this request was already decided"));
    render(<AllergiesList patientId={PATIENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("this request was already decided");
  });
});
