/** @jest-environment jsdom */
/**
 * S05b-f: a patient with a waiting request to remove or correct a condition she entered herself sees one plain line on that
 * condition and can withdraw it; a condition with no request shows neither. The words are plain English with no dash used as punctuation.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mutateAsync = jest.fn();
let conditions: Array<Record<string, unknown>> = [];
let pending: Array<{ id: string; condition_id: string | null }> = [];

jest.mock("@/lib/queries/conditions", () => ({
  useConditions: () => ({ data: conditions, isLoading: false }),
  usePendingConditionRequests: () => ({ data: pending }),
  useWithdrawConditionRequest: () => ({ mutateAsync, isPending: false }),
}));
jest.mock("@/components/result-explainer", () => ({ ResultExplainer: () => null }));

import { ConditionsList } from "./conditions-list";

const PATIENT_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mutateAsync.mockReset();
  conditions = [
    { id: "c1", condition_name: "Gout", status: "active", severity: null, date_identified: null },
    { id: "c2", condition_name: "Migraine", status: "suspected", severity: null, date_identified: null },
  ];
  pending = [{ id: "req-1", condition_id: "c1" }];
});

describe("ConditionsList pending change", () => {
  it("shows the status line only on the condition with a waiting request, and keeps the condition on screen", () => {
    render(<ConditionsList patientId={PATIENT_ID} />);
    const lines = screen.getAllByText("Change requested, waiting for your care team");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).not.toMatch(/[–—]/);
    expect(screen.getByText("Gout")).toBeTruthy();
    expect(screen.getByText("Migraine")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Withdraw request" })).toHaveLength(1);
  });

  it("ignores an allergy request row (no condition id)", () => {
    pending = [{ id: "req-9", condition_id: null }];
    render(<ConditionsList patientId={PATIENT_ID} />);
    expect(screen.queryByText(/waiting for your care team/)).toBeNull();
  });

  it("shows nothing when no request is waiting", () => {
    pending = [];
    render(<ConditionsList patientId={PATIENT_ID} />);
    expect(screen.queryByText(/waiting for your care team/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw request" })).toBeNull();
  });

  it("withdraws the right request", async () => {
    mutateAsync.mockResolvedValue(undefined);
    render(<ConditionsList patientId={PATIENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ patientId: PATIENT_ID, requestId: "req-1" }));
  });

  it("shows a failure instead of hiding it", async () => {
    mutateAsync.mockRejectedValue(new Error("this request was already decided"));
    render(<ConditionsList patientId={PATIENT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("this request was already decided");
  });
});
