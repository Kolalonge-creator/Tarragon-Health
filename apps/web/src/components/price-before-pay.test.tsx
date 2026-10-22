import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceBeforePay } from "./price-before-pay";

describe("PriceBeforePay", () => {
  it("shows the naira price before commitment", () => {
    expect(renderToStaticMarkup(<PriceBeforePay kobo={1_250_000} />)).toContain("You pay ₦12,500");
  });
  it("says no charge for zero", () => {
    expect(renderToStaticMarkup(<PriceBeforePay kobo={0} />)).toContain("No charge");
  });
  it("renders nothing when the price is unknown (never a guessed price)", () => {
    expect(renderToStaticMarkup(<PriceBeforePay kobo={null} />)).toBe("");
    expect(renderToStaticMarkup(<PriceBeforePay kobo={undefined} />)).toBe("");
  });
});
