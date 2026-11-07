/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";

const mockMutate = jest.fn();
jest.mock("@/lib/queries/adherence-checkins", () => ({
  usePatientDueCheckins: () => ({
    data: [{ id: "c1", checkin_type: "started", medication: { drug_name: "Amlodipine" } }],
    isLoading: false,
    isError: false,
  }),
  useRespondToCheckin: () => ({ mutate: mockMutate, isPending: false, isError: false }),
  checkinQuestion: (_t: string, d?: string) => `Have you started taking ${d}?`,
}));

import { AdherenceCheckins, NOT_SURE_ANSWER } from "./adherence-checkins";

describe("medication check-in: Not sure (P16)", () => {
  beforeEach(() => mockMutate.mockClear());

  it("records 'Not sure' as the answer without the patient typing anything", () => {
    render(<AdherenceCheckins patientId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "Not sure" }));
    expect(mockMutate).toHaveBeenCalledWith({ checkinId: "c1", response: NOT_SURE_ANSWER });
    expect(NOT_SURE_ANSWER).toBe("Not sure");
  });

  it("keeps Send disabled until something is typed", () => {
    render(<AdherenceCheckins patientId="p1" />);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
