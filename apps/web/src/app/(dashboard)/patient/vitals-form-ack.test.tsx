/** @jest-environment jsdom */
/**
 * After a blood pressure reading is saved the form says what is true: it was received, then the signed wording for its band.
 * A failed save says so and never says "received". (docs/design/BP-immediate-acknowledgement.md)
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { activeWording } from "@tarragon/i18n";
import { VitalsForm } from "./vitals-form";

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

let mockResult: unknown;
jest.mock("./actions", () => ({
  logVital: async () => mockResult,
}));
jest.mock("@/lib/network/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

function save() {
  fireEvent.change(screen.getByLabelText("Systolic (mmHg)"), { target: { value: "142" } });
  fireEvent.change(screen.getByLabelText("Diastolic (mmHg)"), { target: { value: "88" } });
  fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
}

describe("VitalsForm acknowledgement", () => {
  it("a saved blood pressure says it was received and shows the signed wording for the band", async () => {
    mockResult = { success: true, bpAckLevel: "amber" };
    render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save();
    const text = await screen.findByText(/Received by TarragonHealth\./);
    expect(text.textContent).toContain(activeWording("TRI-003").title);
    expect(text.textContent).not.toMatch(/reviewed|within \d|hours/i);
  });

  it("a failed save says it was not saved and never says received", async () => {
    mockResult = { error: "Couldn't save that reading. Check your connection and try again." };
    render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save();
    expect(await screen.findByText(/Couldn't save that reading/)).toBeTruthy();
    expect(screen.queryByText(/Received by TarragonHealth/)).toBeNull();
  });

  it("a saved reading whose safety check did not finish still says received, and also shows the honest error", async () => {
    mockResult = { success: true, bpAckLevel: "green", error: "Your reading was saved, but we could not finish checking it against your care protocols." };
    render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save();
    expect(await screen.findByText(/Received by TarragonHealth\./)).toBeTruthy();
    expect(screen.getByText(/could not finish checking it/)).toBeTruthy();
  });
});
