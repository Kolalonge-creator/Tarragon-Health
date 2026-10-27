/** @jest-environment jsdom */
/**
 * S07y: the "taken at a pharmacy or clinic machine" box on the blood pressure form. Closed guard: no box at all. Open: the box, and the place only once it is
 * ticked. The ticked value travels as entry_origin = pharmacy_machine; nothing else about the form (the checks, the confirmation of an unusual value) changes.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vitalsReadingSchema } from "@/lib/validation/vitals";
import { VitalsForm } from "./vitals-form";

jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
let mockLogResult: unknown;
jest.mock("./actions", () => ({ logVital: async () => mockLogResult }));
jest.mock("@/lib/network/use-online-status", () => ({ useOnlineStatus: () => true }));

describe("VitalsForm: pharmacy or clinic machine", () => {
  it("offers no box while the guard is closed (the default)", () => {
    render(<VitalsForm patientId="p1" lockedType="blood_pressure" />);
    expect(screen.queryByLabelText(/pharmacy or clinic machine/i)).toBeNull();
    expect(screen.queryByLabelText(/Which pharmacy or clinic/i)).toBeNull();
  });

  it("offers the box when open, explains that it is not counted in the home average, and asks for a place only once ticked", () => {
    render(<VitalsForm patientId="p1" lockedType="blood_pressure" pharmacyOpen />);
    const box = screen.getByLabelText("This was taken at a pharmacy or clinic machine") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.value).toBe("pharmacy_machine");
    expect(box.getAttribute("name")).toBe("entry_origin");
    expect(screen.getByText(/not counted in your home average/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Which pharmacy or clinic/i)).toBeNull();
    fireEvent.click(box);
    const place = screen.getByLabelText(/Which pharmacy or clinic/i) as HTMLInputElement;
    expect(place.getAttribute("name")).toBe("place_label");
    expect(place.maxLength).toBe(80);
  });

  it("the tick is cleared after a saved reading, so the NEXT home reading is not labelled as a pharmacy one", async () => {
    mockLogResult = { success: true };
    render(<VitalsForm patientId="p1" lockedType="blood_pressure" pharmacyOpen />);
    fireEvent.change(screen.getByLabelText("Systolic (mmHg)"), { target: { value: "128" } });
    fireEvent.change(screen.getByLabelText("Diastolic (mmHg)"), { target: { value: "82" } });
    const box = screen.getByLabelText("This was taken at a pharmacy or clinic machine") as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    await waitFor(() => expect((screen.getByLabelText("This was taken at a pharmacy or clinic machine") as HTMLInputElement).checked).toBe(false));
    expect(screen.queryByLabelText(/Which pharmacy or clinic/i)).toBeNull();
  });

  it("is a blood pressure box only: no box on a glucose form", () => {
    render(<VitalsForm patientId="p1" lockedType="glucose" pharmacyOpen />);
    expect(screen.queryByLabelText(/pharmacy or clinic machine/i)).toBeNull();
  });
});

describe("vitalsReadingSchema: the label", () => {
  const base = { vital_type: "blood_pressure", systolic: "142", diastolic: "88" };
  it("accepts the one label it knows and cleans the place", () => {
    const r = vitalsReadingSchema.safeParse({ ...base, entry_origin: "pharmacy_machine", place_label: "  Corner   Pharmacy " });
    expect(r.success).toBe(true);
    if (r.success && r.data.vital_type === "blood_pressure") expect(r.data).toMatchObject({ entry_origin: "pharmacy_machine", place_label: "Corner Pharmacy" });
  });
  it("a blank place becomes absent (the database refuses a blank place)", () => {
    const r = vitalsReadingSchema.safeParse({ ...base, entry_origin: "pharmacy_machine", place_label: "   " });
    expect(r.success && r.data.vital_type === "blood_pressure" && r.data.place_label).toBeUndefined();
  });
  it("refuses any other label, including the diary's (that has its own sheet)", () => {
    expect(vitalsReadingSchema.safeParse({ ...base, entry_origin: "paper_diary" }).success).toBe(false);
    expect(vitalsReadingSchema.safeParse({ ...base, entry_origin: "kiosk" }).success).toBe(false);
  });
  it("an ordinary reading is unchanged", () => {
    const r = vitalsReadingSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success && r.data.vital_type === "blood_pressure") expect(r.data.entry_origin).toBeUndefined();
  });
});
