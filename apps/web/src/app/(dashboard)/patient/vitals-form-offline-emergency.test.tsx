/** @jest-environment jsdom */
/**
 * INV-06 on the web (S85b): with the network off, a red reading or a ticked emergency symptom shows the emergency guidance from bundled code
 * at once, the reading is never claimed saved, and nothing is sent. A normal reading offline keeps the plain refuse-to-save message only.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { activeWording } from "@tarragon/i18n";
import { expectNoA11yViolations } from "@/test/a11y";
import { VitalsForm } from "./vitals-form";

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const mockLogVital = jest.fn(async () => undefined);
jest.mock("./actions", () => ({
  logVital: () => mockLogVital(),
}));

let mockIsOnline = false;
jest.mock("@/lib/network/use-online-status", () => ({
  useOnlineStatus: () => mockIsOnline,
}));

function fill(sys: string, dia: string) {
  fireEvent.change(screen.getByLabelText("Systolic (mmHg)"), { target: { value: sys } });
  fireEvent.change(screen.getByLabelText("Diastolic (mmHg)"), { target: { value: dia } });
}

describe("VitalsForm offline emergency guidance", () => {
  beforeEach(() => {
    mockLogVital.mockClear();
    mockIsOnline = false;
  });

  it("a very high reading offline shows the signed emergency wording, says it was not saved, and calls nothing", () => {
    render(<VitalsForm patientId="p1" />);
    fill("210", "125");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(activeWording("EMG-001").title);
    expect(dialog.textContent).toContain(activeWording("EMG-001").body);
    expect(screen.getByTestId("offline-not-saved").textContent).toMatch(/has not been saved/i);
    expect(screen.queryByText(/Received by TarragonHealth/)).toBeNull();
    expect(mockLogVital).not.toHaveBeenCalled();
  });

  it("ticking an emergency symptom offline shows the guidance immediately, before any submit", () => {
    render(<VitalsForm patientId="p1" />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByLabelText("Chest pain or pressure"));
    expect(screen.getByRole("alertdialog").textContent).toContain(activeWording("EMG-001").body);
  });

  it("closing the guidance returns to the form, which still refuses to save", () => {
    render(<VitalsForm patientId="p1" />);
    fill("210", "125");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    fireEvent.click(screen.getByRole("button", { name: "I have read this" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText(/you're offline/i)).toBeTruthy();
    expect(mockLogVital).not.toHaveBeenCalled();
  });

  it("a normal reading offline shows no emergency dialog, only the offline message", () => {
    render(<VitalsForm patientId="p1" />);
    fill("118", "76");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByText(/you're offline/i)).toBeTruthy();
  });

  it("online there are no symptom ticks and no offline dialog", () => {
    mockIsOnline = true;
    render(<VitalsForm patientId="p1" />);
    expect(screen.queryByTestId("offline-symptoms")).toBeNull();
    fill("210", "125");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    expect(screen.queryByTestId("offline-emergency-guidance")).toBeNull();
  });

  it("the open dialog passes axe", async () => {
    const view = await expectNoA11yViolations(<VitalsForm patientId="p1" />);
    fireEvent.click(view.getByLabelText("Chest pain or pressure"));
    expect(view.getByRole("alertdialog")).toBeTruthy();
    const { axe } = await import("jest-axe");
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
