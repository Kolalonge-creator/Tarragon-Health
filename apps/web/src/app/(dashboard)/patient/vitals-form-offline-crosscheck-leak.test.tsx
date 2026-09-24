/** @jest-environment jsdom */
/**
 * Three independent review passes on the offline pre-submit guard
 * (docs/OFFLINE_RESILIENCE_AUDIT.md) found the same real bug: the guard was
 * inserted ahead of the crosscheck-bypass check in handleSubmit, but on the
 * offline-blocked path it returned early WITHOUT resetting
 * `confirmedRef.current`. Sequence that leaked it: patient enters an
 * abnormal reading -> crosscheck dialog appears -> patient taps "confirm"
 * right as the connection drops -> confirmAndSave() sets
 * confirmedRef.current = true and calls requestSubmit() -> the offline
 * guard blocks that resubmission but leaves confirmedRef.current = true ->
 * patient reconnects and submits again (same or a freshly-edited abnormal
 * value) -> handleSubmit hits the stale `if (confirmedRef.current)` branch
 * FIRST and returns immediately, silently skipping crosscheckVital/the
 * confirmation dialog for a submission that was never actually confirmed.
 * Fixed by resetting confirmedRef.current in the offline-guard branch too
 * (a blocked attempt isn't a submission, so the one-shot bypass shouldn't
 * survive it). This proves the crosscheck dialog correctly reappears for
 * the next attempt after an offline-blocked confirm, instead of silently
 * bypassing it.
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

function setBloodPressure(systolic: string, diastolic: string) {
  fireEvent.change(screen.getByLabelText("Systolic (mmHg)"), { target: { value: systolic } });
  fireEvent.change(screen.getByLabelText("Diastolic (mmHg)"), { target: { value: diastolic } });
}

describe("VitalsForm — offline guard does not leak the crosscheck one-shot bypass", () => {
  beforeEach(() => {
    mockLogVital.mockClear();
    mockIsOnline = true;
  });

  it("re-shows the crosscheck dialog on the next attempt after a confirm was offline-blocked", () => {
    const { rerender } = render(<VitalsForm patientId="patient-1" />);

    // 195/120 is well past the crosscheck's high-BP threshold (systolic > 160).
    setBloodPressure("195", "120");
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));
    expect(screen.getByText(/blood pressure reading/i)).toBeTruthy();

    // Connection drops right as the patient confirms.
    mockIsOnline = false;
    rerender(<VitalsForm patientId="patient-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Yes, this reading is correct/i }));

    expect(mockLogVital).not.toHaveBeenCalled();
    expect(screen.getByText(/you're offline/i)).toBeTruthy();
    // The crosscheck dialog is gone (confirmAndSave cleared it) — the plain
    // "Save reading" button is back, not the confirm dialog's buttons.
    expect(screen.getByRole("button", { name: "Save reading" })).toBeTruthy();

    // Reconnect and press Save again on the SAME still-abnormal values,
    // without editing anything — this is the exact leak scenario: if
    // confirmedRef.current were still true, this would silently resubmit
    // instead of re-showing the crosscheck dialog.
    mockIsOnline = true;
    rerender(<VitalsForm patientId="patient-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Save reading" }));

    expect(screen.getByText(/blood pressure reading/i)).toBeTruthy();
    expect(mockLogVital).not.toHaveBeenCalled();
  });
});
