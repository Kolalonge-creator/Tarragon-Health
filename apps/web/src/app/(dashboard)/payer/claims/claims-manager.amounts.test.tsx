/** @jest-environment jsdom */
/**
 * The covered amount on a claim is what the insurer pays, so it is read exactly or refused. The loose parser
 * deleted every comma and space and rounded past two decimals, so "1,5000" went to the approval screen as ₦15,000.
 *
 * The box is a number input, which already stops commas, spaces and letters before they reach the form. What it
 * does allow, and what the old parser accepted, is scientific notation and extra decimals, so those are tested.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
const adjudicate = jest.fn(async () => ({ message: "Done" }));
jest.mock("./actions", () => ({ adjudicateClaimAction: (...a: unknown[]) => (adjudicate as (...x: unknown[]) => unknown)(...a) }));

import { ClaimsManager } from "./claims-manager";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});
beforeEach(() => adjudicate.mockClear());

const row = {
  id: "c1", service_category: "consultation", billed_amount_kobo: 5000000, insurer_covered_kobo: null, patient_copay_kobo: 0,
  status: "submitted", claim_reference: null, denial_reason: null, submitted_at: "2026-10-20T10:00:00Z", insurance_policies: null,
};
const covered = () => screen.getByPlaceholderText("Covered (₦)") as HTMLInputElement;
const review = (value: string) => {
  const view = render(<ClaimsManager rows={[row]} />);
  fireEvent.change(covered(), { target: { value } });
  fireEvent.submit(covered().closest("form") as HTMLFormElement);
  return view;
};

describe("claim covered amount", () => {
  it("shows the exact amount on the approval screen", () => {
    const view = review("1250.50");
    const dialog = view.container.querySelector("dialog[open]") as HTMLElement;
    expect(within(dialog).getByText("Insurer covers").nextSibling?.textContent).toBe("₦1,250.50");
  });

  it.each(["1e3", "12.345"])("refuses %s with a reason and opens no approval", (value) => {
    const view = review(value);
    expect(view.container.querySelector("dialog[open]")).toBeNull();
    expect(screen.getByText(/^Covered amount: /)).toBeTruthy();
    expect(adjudicate).not.toHaveBeenCalled();
  });

  it("asks for the amount when it is blank", () => {
    const view = review("");
    expect(view.container.querySelector("dialog[open]")).toBeNull();
    expect(screen.getByText("Enter the covered amount in naira.")).toBeTruthy();
  });

  it("sends the exact whole kobo on Confirm", async () => {
    const view = review("1250.50");
    const dialog = view.container.querySelector("dialog[open]") as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve claim" }));
    await waitFor(() => expect(adjudicate).toHaveBeenCalledTimes(1));
    const sent = (adjudicate.mock.calls[0] as unknown as [unknown, FormData])[1];
    expect(sent.get("insurerCoveredKobo")).toBe("125050");
  });
});
