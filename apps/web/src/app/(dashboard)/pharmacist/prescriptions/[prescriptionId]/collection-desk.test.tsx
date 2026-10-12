/** @jest-environment jsdom */
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

type Opts = { onSuccess?: (d: unknown) => void };
const verifyAnswer: { current: Record<string, unknown> } = { current: {} };
const dispenseAnswer: { current: Record<string, unknown> } = { current: {} };
jest.mock("@/lib/pharmacy-collection/desk-queries", () => ({
  useVerifyCollection: () => ({ mutate: (_i: unknown, o: Opts) => o.onSuccess?.(verifyAnswer.current), isPending: false, isError: false }),
  useDispensePrescription: () => ({ mutate: (_i: unknown, o: Opts) => o.onSuccess?.(dispenseAnswer.current), isPending: false, isError: false }),
  usePrescriptionQuestions: () => ({ data: [], isError: false }),
  useAskPrescriber: () => ({ mutate: jest.fn(), isPending: false, isError: false, isSuccess: false }),
  useReportOutOfStock: () => ({ mutate: jest.fn(), isPending: false, isError: false }),
}));

import { CollectionDesk } from "./collection-desk";
import { CONTROLLED_AT_COUNTER_TEXT } from "@/lib/pharmacy-collection/model";

/**
 * OQ-276: when the code is right but the medicine is on the controlled list, the counter says so in plain words, shows no patient detail and offers
 * no supply form; the same words are used if the supply call itself is refused.
 */
describe("CollectionDesk controlled medicine (OQ-276)", () => {
  it("shows the plain message and no supply form after the check", () => {
    verifyAnswer.current = { outcome: "controlled_medicine", patient_name: null, patient_number: null, items: null, allergies: null, supplies_dispensed: 0, supplies_permitted: 0, outstanding_note: null };
    render(<CollectionDesk prescriptionId="22222222-2222-2222-2222-222222222222" />);
    fireEvent.change(screen.getByLabelText(/code the patient shows/i), { target: { value: "ABCD2345" } });
    fireEvent.click(screen.getByRole("button", { name: /check code/i }));
    expect(screen.getByRole("status").textContent).toBe(CONTROLLED_AT_COUNTER_TEXT);
    expect(screen.queryByText(/record supply|record as supplied/i)).toBeNull();
    expect(CONTROLLED_AT_COUNTER_TEXT).not.toMatch(/[—–]|warning/i);
  });
});
