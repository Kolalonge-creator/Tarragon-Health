/** @jest-environment jsdom */
/**
 * S53 (8.1, 8.2, 8.7): the patient's add-a-medicine form.
 *  - a catalogue suggestion fills the form but the patient still submits it;
 *  - a pack-photo prefill saves NOTHING until the patient ticks "I have checked these details";
 *  - with the go-live guard open, adding a second ACE inhibitor shows a warning first, advice only, with a way to continue;
 *  - with the guard closed (the default) the add goes straight through exactly as before;
 *  - the warning never tells the patient to stop a medicine.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mutate = jest.fn();
let guardOpen = false;
const checkMedicationPack = jest.fn();

jest.mock("@/lib/queries/medications", () => ({
  useAddMedication: () => ({ mutate, reset: jest.fn(), error: null, isError: false, isPending: false }),
  useMedications: () => ({
    data: [{ id: "m1", drug_name: "Lisinopril 10mg", dose: "10mg", prescriber_name: null, source: "clinician" }],
  }),
}));
jest.mock("@/lib/queries/medicine-catalogue", () => ({
  useInteractionCheckOpen: () => ({ data: guardOpen }),
  useMedicineCatalogue: () => ({
    isPending: false,
    isError: false,
    data: [{ id: "c1", brandName: null, genericName: "Ramipril", strength: "5 mg", form: "tablet", nafdacNumber: null, isVerified: false }],
  }),
}));
jest.mock("@/lib/medications/pack-actions", () => ({ checkMedicationPack: (...a: unknown[]) => checkMedicationPack(...a) }));
jest.mock("./actions", () => ({ checkMedicationSafetyAfterAdd: jest.fn() }));

import { AddMedicationForm } from "./add-medication-form";

beforeEach(() => {
  mutate.mockReset();
  checkMedicationPack.mockReset();
  guardOpen = false;
});

function type(name: string) {
  fireEvent.change(screen.getByLabelText("Drug name"), { target: { value: name } });
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Add medication" }));

describe("patient add form: catalogue", () => {
  it("shows a suggestion, fills name and strength from it, and does not save until the patient submits", () => {
    render(<AddMedicationForm patientId="p1" source="patient" />);
    type("rami");
    expect(screen.getByText(/has not been checked against NAFDAC/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ramipril 5 mg tablet/ }));
    // the list closes once a suggestion is picked
    expect(screen.queryByRole("button", { name: /Ramipril 5 mg tablet/ })).toBeNull();
    expect((screen.getByLabelText("Drug name") as HTMLInputElement).value).toBe("Ramipril");
    expect((screen.getByLabelText("Dose") as HTMLInputElement).value).toBe("5 mg");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("a name that is not listed can still be added by hand", () => {
    render(<AddMedicationForm patientId="p1" source="patient" />);
    type("Some local remedy");
    expect(screen.getByText(/Not in our list/)).toBeTruthy();
    submit();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("the clinician form shows no catalogue or photo helpers", () => {
    render(<AddMedicationForm patientId="p1" source="clinician" />);
    expect(screen.queryByText(/Fill this in from a photo/)).toBeNull();
  });
});

describe("patient add form: pack photo prefill", () => {
  it("fills the form, then refuses to save until the patient confirms against the pack", async () => {
    checkMedicationPack.mockResolvedValue({
      ok: true,
      check: { verdict: "not_on_your_list" },
      reading: { drug_name: "Amlodipine", brand_name: null, strength: "5mg", form: "tablet", nafdac_number: null, confidence: "low", unreadable_reason: null },
    });
    const { container } = render(<AddMedicationForm patientId="p1" source="patient" />);
    const file = new File(["x"], "pack.jpg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect((screen.getByLabelText("Drug name") as HTMLInputElement).value).toBe("Amlodipine"));
    expect((screen.getByLabelText("Dose") as HTMLInputElement).value).toBe("5mg");
    expect(screen.getByText(/hard to read/i)).toBeTruthy();

    submit();
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/checked these details against my pack/);

    fireEvent.click(screen.getByRole("checkbox", { name: /checked these details against my pack/ }));
    submit();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("an unreadable photo changes nothing and says so", async () => {
    checkMedicationPack.mockResolvedValue({
      ok: true,
      check: { verdict: "unreadable" },
      reading: { drug_name: null, brand_name: null, strength: null, form: null, nafdac_number: null, confidence: "low", unreadable_reason: "blurred" },
    });
    const { container } = render(<AddMedicationForm patientId="p1" source="patient" />);
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(screen.getByText(/could not read that photo/i)).toBeTruthy());
    expect((screen.getByLabelText("Drug name") as HTMLInputElement).value).toBe("");
  });
});

describe("patient add form: interaction and duplication check (go-live guard)", () => {
  it("guard closed: adding a duplicate ACE inhibitor goes straight through (nothing changes until the guard is opened)", () => {
    guardOpen = false;
    render(<AddMedicationForm patientId="p1" source="patient" />);
    type("Ramipril");
    submit();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Before you add this medicine/)).toBeNull();
  });

  it("ACCEPTANCE: guard open, a second ACE inhibitor shows a warning first; advice only; the patient can still add it", () => {
    guardOpen = true;
    render(<AddMedicationForm patientId="p1" source="patient" />);
    type("Ramipril");
    submit();
    expect(mutate).not.toHaveBeenCalled();
    const warning = screen.getByText(/Before you add this medicine/).closest("[role=alert]") as HTMLElement;
    expect(warning.textContent).toMatch(/care team/);
    expect(warning.textContent).toMatch(/Do not stop a prescribed medicine on your own/);
    expect(warning.textContent).not.toMatch(/\bstop (taking|one|it|them)\b/i);
    expect(screen.getByRole("link", { name: /Message your care team/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Add it anyway/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toMatchObject({ drug_name: "Ramipril", source: "patient" });
  });

  it("guard open, nothing found: adds with no pause", () => {
    guardOpen = true;
    render(<AddMedicationForm patientId="p1" source="patient" />);
    type("Paracetamol");
    submit();
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
