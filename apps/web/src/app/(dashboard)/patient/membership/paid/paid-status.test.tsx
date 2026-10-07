/** @jest-environment jsdom */
/**
 * The payment return page (S25): coming back from Paystack proves nothing, so it asks the server, shows what is true, keeps
 * asking while a bank transfer is pending, and never says "paid" for anything but a paid order.
 */
import { act, render, screen } from "@testing-library/react";
import { PaidStatus } from "./paid-status";

const mutateAsync = jest.fn();
jest.mock("@/lib/queries/commerce", () => ({ useVerifyOrder: () => ({ mutateAsync }) }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

beforeEach(() => {
  jest.useFakeTimers();
  mutateAsync.mockReset();
});
afterEach(() => jest.useRealTimers());

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("PaidStatus", () => {
  it("shows the payment as received only when the server says paid", async () => {
    mutateAsync.mockResolvedValue({ state: "paid", outcome: "paid" });
    render(<PaidStatus reference="tho_0123456789abcdef" locale="en" />);
    await settle();
    expect(screen.getByText("Payment received")).toBeTruthy();
    expect(mutateAsync).toHaveBeenCalledWith("tho_0123456789abcdef");
  });

  it("keeps asking every few seconds while pending, then shows paid when it lands", async () => {
    mutateAsync.mockResolvedValueOnce({ state: "created", outcome: "pending" }).mockResolvedValue({ state: "paid", outcome: "paid" });
    render(<PaidStatus reference="tho_0123456789abcdef" locale="en" />);
    await settle();
    expect(screen.getByText(/have not received your payment yet/)).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await settle();
    expect(screen.getByText("Payment received")).toBeTruthy();
    expect(mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("stops asking after about two minutes and offers a manual check", async () => {
    mutateAsync.mockResolvedValue({ state: "created", outcome: "pending" });
    render(<PaidStatus reference="tho_0123456789abcdef" locale="en" />);
    for (let i = 0; i < 40; i++) {
      await settle();
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
    }
    expect(mutateAsync.mock.calls.length).toBe(30);
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("treats a failed charge as failed and a mismatch as a mismatch, never as paid", async () => {
    mutateAsync.mockResolvedValue({ state: "failed", outcome: "unpaid" });
    const { unmount } = render(<PaidStatus reference="tho_0123456789abcdef" locale="en" />);
    await settle();
    expect(screen.getByText(/did not go through/)).toBeTruthy();
    expect(screen.queryByText("Payment received")).toBeNull();
    unmount();
    mutateAsync.mockResolvedValue({ state: "created", outcome: "mismatch" });
    render(<PaidStatus reference="tho_0123456789abcdef" locale="en" />);
    await settle();
    expect(screen.getByText(/does not match this order/)).toBeTruthy();
  });

  it("treats a failed server call as still pending, and no reference as failed without asking", async () => {
    mutateAsync.mockRejectedValue(new Error("offline"));
    const { unmount } = render(<PaidStatus reference="tho_0123456789abcdef" locale="en" />);
    await settle();
    expect(screen.getByText(/have not received your payment yet/)).toBeTruthy();
    unmount();
    mutateAsync.mockReset();
    render(<PaidStatus reference={null} locale="en" />);
    await settle();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/did not go through/)).toBeTruthy();
  });
});
