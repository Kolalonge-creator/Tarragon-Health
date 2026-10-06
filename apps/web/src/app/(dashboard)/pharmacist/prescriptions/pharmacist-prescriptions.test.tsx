/** @jest-environment jsdom */
/**
 * S28: the pharmacy's list and detail. The list never shows a medicine; opening a prescription is a deliberate click that
 * calls the audited function; a supply needs the code; a partial supply needs a note; flags go to the right function.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import "@/test/a11y";
import { PharmacistPrescriptions, type InboxRow } from "./pharmacist-prescriptions";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const openPharmacyPrescription = jest.fn();
const dispensePrescription = jest.fn();
const flagPrescription = jest.fn();
jest.mock("@/lib/pharmacy-collection/actions", () => ({
  openPharmacyPrescription: (...a: unknown[]) => openPharmacyPrescription(...a),
  dispensePrescription: (...a: unknown[]) => dispensePrescription(...a),
  flagPrescription: (...a: unknown[]) => flagPrescription(...a),
}));

const ID = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
const ROW: InboxRow = { prescription_id: ID, collection_code: "K7M2QX9P", state: "sent", sent_at: "2026-10-06T09:00:00Z", dispensed_at: null, first_name: "Ada", medicine_count: 2, has_open_flag: false, is_test: false };
const DETAIL = {
  prescription_id: ID, collection_code: "K7M2QX9P", state: "sent" as const, sent_at: null, dispensed_at: null, signed_at: "2026-10-06T08:00:00Z", signed_by_name: "Dr A",
  patient: { full_name: "Ada Obi", age_years: 41 }, allergies: [{ allergen: "Penicillin", reaction: "Rash", severity: "moderate" }],
  items: [{ drug_name: "Amlodipine", dose: "5 mg", frequency: "once daily", quantity: "30 tablets" }], questions: [], supplies_recorded: 0, supplies_permitted: 1, is_test: false,
};

beforeEach(() => {
  refresh.mockReset();
  openPharmacyPrescription.mockReset().mockResolvedValue({ ok: true, detail: DETAIL });
  dispensePrescription.mockReset().mockResolvedValue({ ok: true });
  flagPrescription.mockReset().mockResolvedValue({ ok: true });
});

async function openIt() {
  render(<PharmacistPrescriptions rows={[ROW]} />);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  fireEvent.click(screen.getByRole("button", { name: "Open prescription" }));
  await screen.findByText("Amlodipine, 5 mg", undefined, { timeout: 5000 });
}

describe("PharmacistPrescriptions", () => {
  it("shows the code, a first name and a count, but no medicine and no surname, until a prescription is opened", () => {
    render(<PharmacistPrescriptions rows={[ROW]} />);
    expect(screen.getByText("K7M2QX9P")).toBeTruthy();
    expect(screen.getByText(/Ada, 2 medicines/)).toBeTruthy();
    expect(screen.queryByText(/amlodipine/i)).toBeNull();
    expect(openPharmacyPrescription).not.toHaveBeenCalled();
  });

  it("opening is two deliberate clicks and asks the audited function once", async () => {
    await openIt();
    expect(openPharmacyPrescription).toHaveBeenCalledTimes(1);
    expect(openPharmacyPrescription).toHaveBeenCalledWith(ID);
    expect(screen.getByText(/Ada Obi, 41 years/)).toBeTruthy();
    expect(screen.getByText(/Penicillin/)).toBeTruthy();
  });

  it("a supply sends what was typed, and a wrong code shows the plain reason", async () => {
    dispensePrescription.mockResolvedValueOnce({ ok: false, error: "That code does not match. Check it with the patient and try again." });
    await openIt();
    fireEvent.change(screen.getByLabelText(/Collection code/), { target: { value: "WRONG" } });
    fireEvent.change(screen.getByLabelText("Pharmacist name"), { target: { value: "Ada Pharmacist" } });
    fireEvent.change(screen.getByLabelText("Batch number"), { target: { value: "B7" } });
    fireEvent.change(screen.getByLabelText("Batch expiry"), { target: { value: "2027-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark dispensed" }));
    await screen.findByText(/That code does not match/, undefined, { timeout: 5000 });
    expect(dispensePrescription).toHaveBeenCalledWith(
      expect.objectContaining({ prescriptionId: ID, code: "WRONG", pharmacistName: "Ada Pharmacist", batchNumber: "B7", batchExpiry: "2027-06-30", partial: false }),
    );
    fireEvent.change(screen.getByLabelText(/Collection code/), { target: { value: "K7M2QX9P" } });
    // the button reads "Saving" until the first answer has fully settled
    fireEvent.click(await screen.findByRole("button", { name: "Mark dispensed" }, { timeout: 5000 }));
    await screen.findByText("Supply recorded.", undefined, { timeout: 5000 });
    expect(refresh).toHaveBeenCalled();
  });

  it("a partial supply asks what is outstanding", async () => {
    await openIt();
    fireEvent.click(screen.getByLabelText(/Partial supply/));
    expect(screen.getByLabelText("What is outstanding")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record partial supply" })).toBeTruthy();
  });

  it("the batch and its expiry are required, and the screen never calls a batch genuine", async () => {
    await openIt();
    expect((screen.getByLabelText("Batch number") as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText("Batch expiry") as HTMLInputElement).required).toBe(true);
    expect(screen.getByText(/does not check that a batch is genuine/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/verified batch|batch verified|authentic/i);
  });

  it("out of stock goes to the flag function, and a question is chosen from a fixed list (no free text)", async () => {
    await openIt();
    fireEvent.click(screen.getByRole("button", { name: /We cannot supply this/ }));
    await waitFor(() => expect(flagPrescription).toHaveBeenCalledWith({ prescriptionId: ID, kind: "out_of_stock" }), { timeout: 5000 });
    await screen.findByText("The patient has been asked to choose another pharmacy.", undefined, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Ask the prescriber a question" }));
    const choice = screen.getByLabelText("What do you need to ask the prescriber?") as HTMLSelectElement;
    expect(choice.tagName).toBe("SELECT");
    expect(Array.from(choice.options).map((o) => o.value).filter(Boolean)).toEqual([
      "dose_unclear", "strength_unavailable", "substitute_needed", "allergy_or_interaction", "details_do_not_match", "call_me",
    ]);
    expect(screen.queryByRole("textbox", { name: /question/i })).toBeNull();
    fireEvent.change(choice, { target: { value: "dose_unclear" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(flagPrescription).toHaveBeenCalledWith({ prescriptionId: ID, kind: "query_to_prescriber", reason: "dose_unclear" }), { timeout: 5000 });
  });

  it("shows the questions already asked and the prescriber's fixed answer, and says an answer changes nothing", async () => {
    openPharmacyPrescription.mockResolvedValue({
      ok: true,
      detail: {
        ...DETAIL,
        questions: [
          { asked_at: "2026-10-06T09:00:00Z", reason_code: "substitute_needed", answered_at: "2026-10-06T10:00:00Z", answer_code: "new_prescription_coming" },
          { asked_at: "2026-10-06T11:00:00Z", reason_code: "call_me", answered_at: null, answer_code: null },
        ],
      },
    });
    await openIt();
    expect(screen.getByText(/A substitute may be needed, asked .* Answer: A new prescription is coming\./)).toBeTruthy();
    expect(screen.getByText(/Please call the pharmacy, asked .* Not answered yet\./)).toBeTruthy();
    expect(screen.getByText(/never changes the signed prescription/)).toBeTruthy();
  });

  it("a prescription that is not this pharmacy's shows the refusal and no detail", async () => {
    openPharmacyPrescription.mockResolvedValue({ ok: false, error: "That prescription could not be found at your pharmacy." });
    render(<PharmacistPrescriptions rows={[ROW]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Open prescription" }));
    await screen.findByText(/could not be found at your pharmacy/, undefined, { timeout: 5000 });
    expect(screen.queryByText(/Amlodipine/)).toBeNull();
  });

  it("has no axe violations (list, opened detail)", async () => {
    const { container } = render(<PharmacistPrescriptions rows={[ROW]} />);
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Open prescription" }));
    await screen.findByText("Amlodipine, 5 mg", undefined, { timeout: 5000 });
    expect(await axe(container)).toHaveNoViolations();
  });
});
