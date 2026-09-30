/** @jest-environment jsdom */
/**
 * PayByCard is the only way to buy a one-off service credit: a single card
 * (Paystack) button, with no platform-credit option or balance text.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PayByCard } from "./pay-by-card";

const mockPurchase = jest.fn();
jest.mock("@/lib/billing/purchase-service-product", () => ({
  purchaseServiceProduct: (...args: unknown[]) => mockPurchase(...args),
}));
jest.mock("@/components/billing/paystack-fee-notice", () => ({
  PaystackFeeNotice: () => null,
}));

describe("PayByCard", () => {
  beforeEach(() => mockPurchase.mockReset());

  it("offers exactly one payment button and no platform credit option", () => {
    render(<PayByCard serviceProductCode="async_consult_credit" callbackPath="/patient/care" onError={jest.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/platform credit/i)).toBeNull();
  });

  it("reports a purchase error back to the caller", async () => {
    mockPurchase.mockResolvedValue({ error: "Could not start checkout" });
    const onError = jest.fn();
    render(<PayByCard serviceProductCode="async_consult_credit" callbackPath="/patient/care" onError={onError} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Could not start checkout"));
    expect(mockPurchase).toHaveBeenCalledWith({
      serviceProductCode: "async_consult_credit",
      callbackPath: "/patient/care",
    });
  });

  it("calls onSuccess when the purchase was free and never left the page", async () => {
    mockPurchase.mockResolvedValue({ activated: true });
    const onSuccess = jest.fn();
    render(
      <PayByCard
        serviceProductCode="async_consult_credit"
        callbackPath="/patient/care"
        onError={jest.fn()}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("reports an error, never success, when the result has no checkout URL and is not activated", async () => {
    mockPurchase.mockResolvedValue({});
    const onSuccess = jest.fn();
    const onError = jest.fn();
    render(
      <PayByCard
        serviceProductCode="async_consult_credit"
        callbackPath="/patient/care"
        onError={onError}
        onSuccess={onSuccess}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
