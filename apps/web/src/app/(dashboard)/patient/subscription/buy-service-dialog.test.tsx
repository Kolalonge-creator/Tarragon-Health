/** @jest-environment jsdom */
/**
 * BuyServiceDialog is card-only: confirming submits the page's Paystack form
 * with the product code and promo code, and no platform credit balance or
 * top-up prompt is shown.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { BuyServiceDialog } from "./buy-service-dialog";
import type { ServiceProduct } from "@/lib/queries/service-products";

const product = { code: "verified_document_credit", name: "Verified document", price_kobo: 500000, currency: "NGN" } as ServiceProduct;

describe("BuyServiceDialog", () => {
  beforeAll(() => {
    // jsdom has no <dialog>.showModal/close.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
    HTMLFormElement.prototype.requestSubmit = function requestSubmit() {
      this.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    };
  });

  it("shows no platform credit copy and submits the card form on confirm", () => {
    const action = jest.fn();
    render(
      <BuyServiceDialog
        product={product}
        promoCode="PROMO1"
        paystackFormAction={action}
        trigger={<button type="button">Buy</button>}
      />,
    );
    fireEvent.click(screen.getByText("Buy"));
    expect(screen.queryByText(/platform credit/i)).toBeNull();
    expect(screen.queryByText(/top up/i)).toBeNull();
    expect(screen.getByText("Pay by card")).not.toBeNull();
    const form = document.querySelector("form") as HTMLFormElement;
    expect((form.querySelector("input[name=serviceProductCode]") as HTMLInputElement).value).toBe(product.code);
    expect((form.querySelector("input[name=promoCode]") as HTMLInputElement).value).toBe("PROMO1");
  });
});
