/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockMutate = jest.fn();
const mockRaise = jest.fn();
jest.mock("@/lib/queries/adherence-checkins", () => ({
  usePatientDueCheckins: () => ({
    data: [{ id: "c1", checkin_type: "started", medication: { drug_name: "Amlodipine" } }],
    isLoading: false,
    isError: false,
  }),
  useRespondToCheckin: () => ({ mutate: mockMutate, isPending: false, isError: false }),
  checkinQuestion: (_t: string, d?: string) => `Have you started taking ${d}?`,
}));
jest.mock("./medication-not-sure-actions", () => ({ raiseMedicationNotSureTask: (i: unknown) => mockRaise(i) }));

import { AdherenceCheckins, NOT_SURE_ANSWER } from "./adherence-checkins";

describe("medication check-in: Not sure (P16)", () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockRaise.mockReset();
  });

  it("raises the routine care-team task, then records 'Not sure' as the answer", async () => {
    mockRaise.mockResolvedValue({ ok: true, alreadyRaisedToday: false });
    render(<AdherenceCheckins patientId="p1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    });
    expect(mockRaise).toHaveBeenCalledWith({ source: "checkin", checkinId: "c1" });
    expect(mockMutate).toHaveBeenCalledWith({ checkinId: "c1", response: NOT_SURE_ANSWER });
  });

  it("keeps the question and says so when the task cannot be raised (or is refused while acting)", async () => {
    mockRaise.mockResolvedValue({ ok: false, error: "We couldn't let your care team know just now. Please try again." });
    render(<AdherenceCheckins patientId="p1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't let your care team know/);
  });

  it("keeps Send disabled until something is typed", () => {
    render(<AdherenceCheckins patientId="p1" />);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
