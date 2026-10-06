/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScribeConsentDialog } from "./consent-dialog";

const record = jest.fn();
jest.mock("@/lib/scribe/actions", () => ({ recordScribeConsent: (...a: unknown[]) => record(...a) }));

const PATIENT = "11111111-1111-4111-8111-111111111111";
const props = { patientId: PATIENT, language: "en-NG" as const };

beforeEach(() => jest.clearAllMocks());

describe("ScribeConsentDialog (the patient's in-app answer is the only consent, OQ-161)", () => {
  it("does not ask the clinician to agree for the patient: it starts the note-taker and records a granted row once the database accepts", async () => {
    record.mockResolvedValue({ id: "c1" });
    const onConsented = jest.fn();
    render(<ScribeConsentDialog {...props} onConsented={onConsented} onDeclined={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "I agree" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start AI note-taker" }));
    await waitFor(() => expect(onConsented).toHaveBeenCalledWith("c1"));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ patientId: PATIENT, granted: true }));
  });

  it("says the patient has not allowed it when the database refuses, and does not start", async () => {
    record.mockRejectedValue(new Error("The patient has not allowed the AI note-taker for a live consultation with you in the app."));
    const onConsented = jest.fn();
    render(<ScribeConsentDialog {...props} onConsented={onConsented} onDeclined={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start AI note-taker" }));
    expect((await screen.findByText(/has not allowed the AI note-taker for this consultation in the app/)).textContent).toBeTruthy();
    expect(onConsented).not.toHaveBeenCalled();
  });

  it("shows a generic message for any other failure", async () => {
    record.mockRejectedValue(new Error("network down"));
    render(<ScribeConsentDialog {...props} onConsented={jest.fn()} onDeclined={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Start AI note-taker" }));
    await waitFor(() => expect(screen.getByText(/could not start the AI note-taker/)).toBeTruthy());
  });

  it("'Write the note myself' records nothing", () => {
    const onDeclined = jest.fn();
    render(<ScribeConsentDialog {...props} onConsented={jest.fn()} onDeclined={onDeclined} />);
    fireEvent.click(screen.getByRole("button", { name: "Write the note myself" }));
    expect(onDeclined).toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
