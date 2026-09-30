/** @jest-environment jsdom */
/**
 * Paying for a pharmacy order is card-only: the button no longer offers a
 * "Pay with Platform Credit" path, and takes no patientId for a balance lookup.
 */
import { render, screen } from "@testing-library/react";
import { PayForPharmacyOrderButton } from "./pay-for-pharmacy-order-button";

jest.mock("@/app/(dashboard)/patient/pharmacy/actions", () => ({
  payForPharmacyOrder: jest.fn(),
}));
jest.mock("@/components/promo-code-field", () => ({
  PromoCodeField: () => <div data-testid="promo" />,
}));
jest.mock("@/components/billing/price-breakdown-confirm", () => ({
  PriceBreakdownConfirm: ({ triggerLabel }: { triggerLabel: string }) => <button type="submit">{triggerLabel}</button>,
}));

describe("PayForPharmacyOrderButton", () => {
  it("shows only the card confirm button, with no platform credit option", () => {
    render(<PayForPharmacyOrderButton orderId="order-1" amountKobo={500000} />);
    expect(screen.getByRole("button", { name: /Pay ₦5,000 to confirm/ })).not.toBeNull();
    expect(screen.queryByText(/credit/i)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
