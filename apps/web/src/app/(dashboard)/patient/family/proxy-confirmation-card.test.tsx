/** @jest-environment jsdom */
/**
 * What the parent sees (S04, safety case 23): every category starts UNticked so the default is to share nothing, only
 * the requester's first name is shown, and nothing renders when there is no pending request.
 */
import { render, screen } from "@testing-library/react";
import { ProxyConfirmationCard } from "./proxy-confirmation-card";

jest.mock("./proxy-setup-actions", () => ({
  confirmProxySetupAction: jest.fn(),
  declineProxySetupAction: jest.fn(),
}));

const SETUP = { id: "6f1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e11", requester_first_name: "Adaeze", expires_at: "2026-10-04T10:00:00Z" };

describe("ProxyConfirmationCard", () => {
  it("renders nothing without a pending request", () => {
    const { container } = render(<ProxyConfirmationCard setups={[]} locale="en" />);
    expect(container.innerHTML).toBe("");
  });

  it("starts with every category unticked and shows only the requester's first name", () => {
    render(<ProxyConfirmationCard setups={[SETUP]} locale="en" />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(9); // eight health categories plus mental wellbeing (S56), each its own choice
    for (const box of boxes) expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.getByLabelText(/Mental wellbeing/)).toBeTruthy();
    expect(screen.getByText(/Adaeze would like to help look after you/)).toBeTruthy();
    expect(screen.getByText(/Adaeze cannot see anything about you yet/)).toBeTruthy();
    expect(screen.getByText(/If you choose nothing, Adaeze will not see any of your health information/)).toBeTruthy();
  });

  it("offers an explicit decline next to confirm", () => {
    render(<ProxyConfirmationCard setups={[SETUP]} locale="en" />);
    expect(screen.getByRole("button", { name: /share what i chose/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /no thanks/i })).toBeTruthy();
  });
});
