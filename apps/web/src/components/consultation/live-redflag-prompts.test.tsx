/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const record = jest.fn();
const dismiss = jest.fn();
jest.mock("@/lib/live-prompts/actions", () => ({
  recordLivePrompt: (...a: unknown[]) => record(...a),
  dismissLivePrompt: (...a: unknown[]) => dismiss(...a),
}));

import { LiveRedFlagPrompts } from "./live-redflag-prompts";

const enc = "11111111-1111-4111-8111-111111111111";
const type = (text: string) => fireEvent.change(screen.getByLabelText("Transcript segment"), { target: { value: text } });
const check = () => fireEvent.click(screen.getByRole("button", { name: /Check for red-flag phrases/ }));

beforeEach(() => {
  record.mockReset();
  dismiss.mockReset();
});

describe("LiveRedFlagPrompts", () => {
  it("shows a dismissible prompt for a red-flag phrase and records only the phrase", async () => {
    record.mockResolvedValue({ ok: true, id: "p1" });
    render(<LiveRedFlagPrompts encounterId={enc} />);
    type("Patient: I have chest pain");
    check();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/chest pain/));
    expect(record).toHaveBeenCalledWith({ encounterId: enc, phrase: "chest pain" });
    expect(JSON.stringify(record.mock.calls)).not.toMatch(/Patient: I have/);
  });

  it("dismisses a prompt", async () => {
    record.mockResolvedValue({ ok: true, id: "p1" });
    dismiss.mockResolvedValue({ ok: true });
    render(<LiveRedFlagPrompts encounterId={enc} />);
    type("chest pain");
    check();
    await waitFor(() => screen.getByRole("alert"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(dismiss).toHaveBeenCalledWith("p1");
  });

  it("says plainly when nothing matched, and records nothing", () => {
    render(<LiveRedFlagPrompts encounterId={enc} />);
    type("Any problems with the tablets?");
    check();
    expect(screen.getByText(/No red-flag phrase/)).toBeTruthy();
    expect(record).not.toHaveBeenCalled();
  });

  it("shows no prompt, and says why, when the guard is off or consent is missing", async () => {
    record.mockResolvedValueOnce({ ok: false, reason: "guard_off" });
    render(<LiveRedFlagPrompts encounterId={enc} />);
    type("chest pain");
    check();
    await waitFor(() => expect(screen.getByText(/not switched on yet/)).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    record.mockResolvedValueOnce({ ok: false, reason: "no_consent" });
    type("seizure");
    check();
    await waitFor(() => expect(screen.getByText(/has not allowed this/)).toBeTruthy());
  });
});
