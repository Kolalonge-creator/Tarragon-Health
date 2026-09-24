/** @jest-environment jsdom */
/**
 * VitalsForm's pre-submit offline guard is the client-side half of the
 * network-resilience fix. An earlier version of this fix wrapped the
 * imported `logVital` in a local try/catch and passed THAT wrapper to
 * useActionState — that broke this form's no-JS/pre-hydration submission
 * fallback (confirmed live: React emits a poison-pill
 * `action="javascript:throw new Error(...)"` for a form whose action isn't
 * a genuine Server Reference). This guard instead blocks a submission
 * BEFORE it reaches `formAction` when the browser already knows it's
 * offline, so `logVital` itself stays wired to useActionState unwrapped —
 * see docs/OFFLINE_RESILIENCE_AUDIT.md §3/§6 for the full account. This
 * proves: (1) a blocked submission never calls the action and shows the
 * offline message instead, (2) a normal online submission is unaffected.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { VitalsForm } from "./vitals-form";

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const mockLogVital = jest.fn(async () => undefined);
jest.mock("./actions", () => ({
  logVital: () => mockLogVital(),
}));

let mockIsOnline = true;
jest.mock("@/lib/network/use-online-status", () => ({
  useOnlineStatus: () => mockIsOnline,
}));

function fillBloodPressure() {
  fireEvent.change(screen.getByLabelText("Systolic (mmHg)"), { target: { value: "120" } });
  fireEvent.change(screen.getByLabelText("Diastolic (mmHg)"), { target: { value: "80" } });
}

describe("VitalsForm offline guard", () => {
  beforeEach(() => {
    mockLogVital.mockClear();
    mockIsOnline = true;
  });

  it("blocks submission and shows the offline message when the browser reports offline", () => {
    mockIsOnline = false;
    render(<VitalsForm patientId="patient-1" />);
    fillBloodPressure();

    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));

    expect(mockLogVital).not.toHaveBeenCalled();
    expect(screen.getByText(/you're offline/i)).toBeTruthy();
  });

  it("submits normally when the browser reports online", () => {
    mockIsOnline = true;
    render(<VitalsForm patientId="patient-1" />);
    fillBloodPressure();

    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));

    expect(mockLogVital).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/you're offline/i)).toBeNull();
  });
});
