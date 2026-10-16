/** @jest-environment jsdom */
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

type Opts = { onSuccess?: (d: unknown) => void };
const verifyAnswer: { current: unknown[] } = { current: [] };
const mutate = jest.fn((_i: unknown, o: Opts) => o.onSuccess?.(verifyAnswer.current));
const dispenseMutate = jest.fn();
jest.mock("@/lib/pharmacy-collection/desk-queries", () => ({
  useVerifyVisit: () => ({ mutate, isPending: false, isError: false }),
  useDispensePrescription: () => ({ mutate: dispenseMutate, isPending: false, isError: false }),
}));

import { VisitDesk } from "./visit-desk";
import { CONTROLLED_AT_COUNTER_TEXT } from "@/lib/pharmacy-collection/model";

const V = "33333333-3333-4333-8333-333333333333";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const okItem = (id: string, drug: string) => ({
  outcome: "ok", prescription_id: id, item_outcome: "ok", patient_name: "Test Patient", patient_number: "TH1", items: [{ drug_name: drug, dose: "5 mg" }],
  allergies: [], supplies_dispensed: 0, supplies_permitted: 1, outstanding_note: null,
});
const refused = (id: string) => ({
  outcome: "ok", prescription_id: id, item_outcome: "controlled_medicine", patient_name: null, patient_number: null, items: null, allergies: null,
  supplies_dispensed: 0, supplies_permitted: 0, outstanding_note: null,
});
const check = () => {
  render(<VisitDesk visitId={V} />);
  fireEvent.change(screen.getByLabelText(/code the patient shows/i), { target: { value: "ABCD2345" } });
  fireEvent.click(screen.getByRole("button", { name: /check code/i }));
};

describe("VisitDesk (S28e, OQ-275)", () => {
  it("checks the code once for the whole visit", () => {
    verifyAnswer.current = [okItem(A, "Amlodipine"), okItem(B, "Losartan")];
    check();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ visit: V, code: "ABCD2345" });
  });
  it("each medicine gets its own supply form, so each is a full or partial supply of its own", () => {
    verifyAnswer.current = [okItem(A, "Amlodipine"), okItem(B, "Losartan")];
    check();
    expect(screen.getByText(/amlodipine/i)).toBeTruthy();
    expect(screen.getByText(/losartan/i)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /record supply/i })).toHaveLength(2);
    expect(screen.getAllByLabelText(/partial supply/i)).toHaveLength(2);
  });
  it("a controlled medicine is refused in plain words with no supply form, while the others can still be supplied", () => {
    verifyAnswer.current = [okItem(A, "Amlodipine"), refused(B)];
    check();
    expect(screen.getByText(CONTROLLED_AT_COUNTER_TEXT)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /record supply/i })).toHaveLength(1);
  });
  it("a wrong, locked or expired code shows no medicine and no supply form", () => {
    for (const outcome of ["wrong_code", "locked", "expired", "not_found"]) {
      verifyAnswer.current = [{ outcome, prescription_id: null, item_outcome: null, patient_name: null, patient_number: null, items: null, allergies: null, supplies_dispensed: 0, supplies_permitted: 0, outstanding_note: null }];
      const { unmount } = render(<VisitDesk visitId={V} />);
      fireEvent.change(screen.getByLabelText(/code the patient shows/i), { target: { value: "WRONG" } });
      fireEvent.click(screen.getByRole("button", { name: /check code/i }));
      expect(screen.queryByRole("button", { name: /record supply/i })).toBeNull();
      expect(screen.getByRole("status")).toBeTruthy();
      unmount();
    }
  });
  it("a supply is sent with the code that was CHECKED, even if the box is edited afterwards (a different string would count against the whole visit)", () => {
    verifyAnswer.current = [okItem(A, "Amlodipine")];
    check();
    fireEvent.change(screen.getByLabelText(/code the patient shows/i), { target: { value: "SOMETHING ELSE" } });
    fireEvent.change(screen.getByLabelText(/pharmacist name/i), { target: { value: "Ada Pharmacist" } });
    fireEvent.change(screen.getByLabelText(/pcn registration number/i), { target: { value: "PCN12345" } });
    fireEvent.change(screen.getByLabelText(/batch number/i), { target: { value: "B-1234" } });
    fireEvent.change(screen.getByLabelText(/expiry date of the pack/i), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /record supply/i }));
    expect(dispenseMutate).toHaveBeenCalledTimes(1);
    expect((dispenseMutate.mock.calls[0][0] as { code: string }).code).toBe("ABCD2345");
  });
  it("the staff text uses no em dash", () => {
    expect(CONTROLLED_AT_COUNTER_TEXT).not.toMatch(/[—–]/);
  });
});
