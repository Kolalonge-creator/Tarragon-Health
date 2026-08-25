import { PAYMENT_METHOD_OPTIONS, parsePaymentMethod, paymentMethodToChannels } from "./channels";

describe("parsePaymentMethod", () => {
  it("accepts the three offered methods", () => {
    expect(parsePaymentMethod("card")).toBe("card");
    expect(parsePaymentMethod("bank_transfer")).toBe("bank_transfer");
    expect(parsePaymentMethod("ussd")).toBe("ussd");
  });

  it("defaults to card for anything missing, unrecognised, or not a string", () => {
    expect(parsePaymentMethod(null)).toBe("card");
    expect(parsePaymentMethod("qr")).toBe("card");
    expect(parsePaymentMethod("")).toBe("card");
  });
});

describe("paymentMethodToChannels", () => {
  it("maps a chosen method to Paystack's single-channel restriction", () => {
    expect(paymentMethodToChannels("card")).toEqual(["card"]);
    expect(paymentMethodToChannels("bank_transfer")).toEqual(["bank_transfer"]);
    expect(paymentMethodToChannels("ussd")).toEqual(["ussd"]);
  });
});

describe("PAYMENT_METHOD_OPTIONS", () => {
  it("offers exactly Card, Bank Transfer, and USSD in that order", () => {
    expect(PAYMENT_METHOD_OPTIONS.map((o) => o.value)).toEqual(["card", "bank_transfer", "ussd"]);
  });
});
