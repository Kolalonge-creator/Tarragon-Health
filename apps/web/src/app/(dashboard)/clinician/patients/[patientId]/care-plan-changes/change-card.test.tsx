/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const signCareChange = jest.fn();
const rejectCareChange = jest.fn();
jest.mock("./actions", () => ({
  signCareChange: (...a: unknown[]) => signCareChange(...a),
  rejectCareChange: (...a: unknown[]) => rejectCareChange(...a),
}));

import { ChangeCard } from "./change-card";
import { parseStaffCareChanges } from "./change-model";

const ROW = {
  id: "c1",
  kind: "medication",
  state: "proposed",
  proposed_by: "engine",
  proposal: { action: "start", item: { drug_name: "Amlodipine", dose: "5 mg", duration_days: 30, quantity: "30 tablets" } },
  before: null,
  rationale: "Home readings stay above the target",
  protocol_version: 3,
  engine_inputs: { average_systolic: 152 },
  patient_summary: "Prefilled text from a draft",
};
const change = (over: Record<string, unknown> = {}) => parseStaffCareChanges([{ ...ROW, ...over }])[0]!;

beforeEach(() => {
  signCareChange.mockReset();
  rejectCareChange.mockReset();
});

describe("ChangeCard", () => {
  it("shows the engine evidence: protocol version, inputs, and that nothing reaches the patient until signed", () => {
    render(<ChangeCard change={change()} patientId="p1" canAct onChanged={jest.fn()} />);
    expect(screen.getByText(/Suggested by the titration engine/)).toBeTruthy();
    expect(screen.getByText(/version 3/)).toBeTruthy();
    expect(screen.getByText("152")).toBeTruthy();
    expect(screen.getByText(/Nothing reaches the patient until you sign/)).toBeTruthy();
  });

  it("signing needs a summary typed by the signer: the box starts empty and the button stays off", () => {
    render(<ChangeCard change={change({ patient_summary: null })} patientId="p1" canAct onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Sign and send to the patient/ }));
    const box = screen.getByLabelText(/What this means for the patient/) as HTMLTextAreaElement;
    expect(box.value).toBe("");
    expect((screen.getByRole("button", { name: "Sign and send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Nothing changes for the patient until they confirm it in the app/)).toBeTruthy();
  });

  it("a safety stop asks for the answers and the retry carries them; an unticked box is never sent as ticked", async () => {
    signCareChange
      .mockResolvedValueOnce({ ok: false, error: "x", safety: { kind: "findings", findings: [{ code: "allergies_unrecorded" }] } })
      .mockResolvedValueOnce({ ok: true });
    const onChanged = jest.fn();
    render(<ChangeCard change={change()} patientId="p1" canAct onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: /Sign and send to the patient/ }));
    fireEvent.change(screen.getByLabelText(/What this means for the patient/), { target: { value: "Your care team wants to start a new medicine." } });
    fireEvent.click(screen.getByRole("button", { name: "Sign and send" }));
    await waitFor(() => expect(screen.getByText(/allergy list is empty/)).toBeTruthy());
    expect(signCareChange.mock.calls[0]![0]).toMatchObject({ allergiesConfirmed: false });
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect((screen.getByRole("button", { name: "Sign and send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Sign and send" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(signCareChange.mock.calls[1]![0]).toMatchObject({ allergiesConfirmed: true, changeId: "c1", patientId: "p1" });
  });

  it("a blocked medicine has no override control", async () => {
    signCareChange.mockResolvedValue({ ok: false, error: "x", safety: { kind: "blocked" } });
    render(<ChangeCard change={change()} patientId="p1" canAct onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Sign and send to the patient/ }));
    fireEvent.change(screen.getByLabelText(/What this means for the patient/), { target: { value: "Your care team wants to start a new medicine." } });
    fireEvent.click(screen.getByRole("button", { name: "Sign and send" }));
    await waitFor(() => expect(screen.getByText(/does not prescribe controlled medicines/)).toBeTruthy());
    expect(screen.queryByLabelText(/Reason for going ahead/)).toBeNull();
    expect((screen.getByRole("button", { name: "Sign and send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a readable refusal is shown as written", async () => {
    signCareChange.mockResolvedValue({ ok: false, error: "You are not allowed to do this for this patient." });
    render(<ChangeCard change={change()} patientId="p1" canAct onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Sign and send to the patient/ }));
    fireEvent.change(screen.getByLabelText(/What this means for the patient/), { target: { value: "Your care team wants to start a new medicine." } });
    fireEvent.click(screen.getByRole("button", { name: "Sign and send" }));
    await waitFor(() => expect(screen.getByText(/You are not allowed/)).toBeTruthy());
  });

  it("reject needs a reason", async () => {
    rejectCareChange.mockResolvedValue({ ok: true });
    const onChanged = jest.fn();
    render(<ChangeCard change={change()} patientId="p1" canAct onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const button = screen.getByRole("button", { name: "Reject this change" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason for rejecting/), { target: { value: "Not needed now" } });
    fireEvent.click(button);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(rejectCareChange).toHaveBeenCalledWith({ patientId: "p1", changeId: "c1", reason: "Not needed now" });
  });

  it("without prescribing authority there are no sign or reject controls", () => {
    render(<ChangeCard change={change()} patientId="p1" canAct={false} onChanged={jest.fn()} />);
    expect(screen.queryByRole("button", { name: /Sign and send to the patient/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("a signed change reads as waiting for the patient with its expiry; later states show their dates", () => {
    const { rerender } = render(
      <ChangeCard change={change({ state: "signed", signed_by: "u", signed_at: "2026-10-06T10:00:00Z", expires_at: "2026-10-13T10:00:00Z", patient_summary: "Your care team has a change." })} patientId="p1" canAct onChanged={jest.fn()} />
    );
    expect(screen.getAllByText(/Waiting for the patient/).length).toBeGreaterThan(0);
    expect(screen.getByText(/lapses on 13 Oct 2026/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign and send to the patient/ })).toBeNull();
    rerender(
      <ChangeCard change={change({ state: "confirmed", signed_by: "u", signed_at: "2026-10-06T10:00:00Z", patient_confirmed_at: "2026-10-08T10:00:00Z", applied_at: "2026-10-08T10:00:00Z", patient_summary: "x y z a b c d e f g" })} patientId="p1" canAct onChanged={jest.fn()} />
    );
    expect(screen.getByText(/Confirmed by the patient on 8 Oct 2026 and applied/)).toBeTruthy();
  });
});
