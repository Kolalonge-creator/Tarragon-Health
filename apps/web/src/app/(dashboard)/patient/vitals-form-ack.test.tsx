/** @jest-environment jsdom */
/**
 * After a blood pressure reading is saved the form says what is true: it was received, then the signed wording only where it is true for every adult.
 * A failed save says so and never says "received". An old "received" never sits beside a reading that was not sent.
 * (docs/design/BP-immediate-acknowledgement.md)
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
let mockOnline = true;
jest.mock("@/lib/network/use-online-status", () => ({
  useOnlineStatus: () => mockOnline,
}));

function save(sys = "142", dia = "88") {
  fireEvent.change(screen.getByLabelText("Systolic (mmHg)"), { target: { value: sys } });
  fireEvent.change(screen.getByLabelText("Diastolic (mmHg)"), { target: { value: dia } });
  fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
  // an unusual value asks for one confirmation before it is saved (the form's crosscheck); a normal one saves at once
  const confirm = screen.queryByRole("button", { name: /yes, this reading is correct/i });
  if (confirm) fireEvent.click(confirm);
}

beforeEach(() => {
  mockOnline = true;
});

describe("VitalsForm acknowledgement", () => {
  it("a saved blood pressure says it was received, with no verdict a stranger to this person could get wrong", async () => {
    mockResult = { success: true, bpAckLevel: "amber" };
    render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save();
    const text = await screen.findByText(/Received by TarragonHealth\./);
    expect(text.textContent).not.toMatch(/Within your target|A little above/);
    expect(text.textContent).not.toMatch(/reviewed|within \d|hours/i);
  });

  it("a high reading adds the signed rest-and-measure-again wording", async () => {
    mockResult = { success: true, bpAckLevel: "red" };
    render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save("165", "102");
    const text = await screen.findByText(/Received by TarragonHealth\./);
    expect(text.textContent).toContain(activeWording("TRI-005").title);
  });

  it("a crisis-range reading adds the signed emergency wording", async () => {
    mockResult = { success: true, bpAckLevel: "emergency" };
    render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save("215", "125");
    const text = await screen.findByText(/Received by TarragonHealth\./);
    expect(text.textContent).toContain(activeWording("EMG-001").title);
  });

  it("a failed save says it was not saved and never says received", async () => {
    mockResult = { error: "Couldn't save that reading. Check your connection and try again." };
    render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save();
    expect(await screen.findByText(/Couldn't save that reading/)).toBeTruthy();
    expect(screen.queryByText(/Received by TarragonHealth/)).toBeNull();
  });

  it("a saved reading whose safety check did not finish says received with no band wording, and shows the honest error", async () => {
    mockResult = { success: true, bpAckLevel: "unknown", error: "Your reading was saved, but we could not finish checking it against your care protocols." };
    render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save();
    const text = await screen.findByText(/Received by TarragonHealth\./);
    expect(text.textContent).not.toMatch(/Within your target/);
    expect(screen.getByText(/could not finish checking it/)).toBeTruthy();
  });

  it("editing the form takes the old acknowledgement away", async () => {
    mockResult = { success: true, bpAckLevel: "amber" };
    render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save();
    await screen.findByText(/Received by TarragonHealth\./);
    fireEvent.change(screen.getByLabelText("Systolic (mmHg)"), { target: { value: "190" } });
    expect(screen.queryByText(/Received by TarragonHealth/)).toBeNull();
  });

  it("going offline and pressing Save shows the offline message and not the old acknowledgement", async () => {
    mockResult = { success: true, bpAckLevel: "amber" };
    const view = render(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save();
    await screen.findByText(/Received by TarragonHealth\./);
    mockOnline = false;
    view.rerender(<VitalsForm patientId="patient-1" lockedType="blood_pressure" />);
    save("143", "89");
    expect(screen.getByText(/you're offline/i)).toBeTruthy();
    expect(screen.queryByText(/Received by TarragonHealth/)).toBeNull();
  });
});
