/** @jest-environment jsdom */
/** S72 (19.11): a donation is a pledge with a reference, never a charge and never a balance. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import { DonateForm } from "./donate-form";

let donations: unknown[];
const pledge = jest.fn();
const cancel = jest.fn();
jest.mock("@/lib/queries/commerce", () => ({
  usePledgeDonation: () => ({ mutateAsync: pledge, isPending: false }),
  useMyDonations: () => ({ data: donations }),
  useCancelMyDonation: () => ({ mutate: cancel, isPending: false }),
}));
beforeEach(() => { donations = []; pledge.mockReset(); cancel.mockReset(); });
afterEach(cleanup);

describe("DonateForm", () => {
  it("is accessible and says no card is charged here", async () => {
    await expectNoA11yViolations(<DonateForm />);
    expect(screen.getByText(/No card is charged here/)).toBeTruthy();
  });
  it("pledges whole naira as kobo and shows the reference to quote with the transfer", async () => {
    pledge.mockResolvedValue({ reference: "CAF-ABCD1234" });
    render(<DonateForm />);
    fireEvent.change(screen.getByLabelText("Amount in naira"), { target: { value: "5000" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pledge this gift" })); });
    expect(pledge).toHaveBeenCalledWith({ amountKobo: 500_000 });
    expect(screen.getByText(/CAF-ABCD1234/)).toBeTruthy();
  });
  it("refuses a non-whole or empty amount before asking the database", async () => {
    render(<DonateForm />);
    fireEvent.change(screen.getByLabelText("Amount in naira"), { target: { value: "12.5" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pledge this gift" })); });
    expect(pledge).not.toHaveBeenCalled();
    expect(screen.getByText(/amount is not allowed/)).toBeTruthy();
  });
  it("says the Fund is not open when the database says so", async () => {
    pledge.mockRejectedValue(new Error("access_fund_not_open"));
    render(<DonateForm />);
    fireEvent.change(screen.getByLabelText("Amount in naira"), { target: { value: "5000" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pledge this gift" })); });
    expect(screen.getByText("The fund is not open yet.")).toBeTruthy();
  });
  it("lists the donor's own gifts with their state, shows no balance, and lets them cancel only a waiting pledge", () => {
    donations = [
      { id: "a", reference: "CAF-AAAA1111", amountKobo: 500_000, state: "pledged", itemNameKey: null, createdAt: "2026-10-01T10:00:00Z", pledgeExpiresAt: "2026-10-15T10:00:00Z" },
      { id: "b", reference: "CAF-BBBB2222", amountKobo: 200_000, state: "received", itemNameKey: null, createdAt: "2026-09-01T10:00:00Z", pledgeExpiresAt: "2026-09-15T10:00:00Z" },
    ];
    const { container } = render(<DonateForm />);
    expect(screen.getAllByRole("button", { name: "Cancel this pledge" })).toHaveLength(1);
    expect(screen.getByText(/Received, thank you/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/balance|available|remaining|credit/i);
    fireEvent.click(screen.getByRole("button", { name: "Cancel this pledge" }));
    expect(cancel).toHaveBeenCalledWith("a");
  });
});
