import { describe, expect, it } from "@jest/globals";
import { resolveCheckoutChannels, CONFIGURED_CHECKOUT_CHANNELS } from "../../../supabase/functions/_shared/commerce/checkout-channels.ts";
import { DEFAULT_CHECKOUT_CHANNELS } from "../../../supabase/functions/_shared/commerce/checkout.ts";

const SHIPPED = ["card", "bank_transfer", "ussd"];

describe("checkout channels are configuration-driven with a safe default", () => {
  it("the default is unchanged", () => {
    expect([...DEFAULT_CHECKOUT_CHANNELS]).toEqual(SHIPPED);
    expect(resolveCheckoutChannels(CONFIGURED_CHECKOUT_CHANNELS)).toEqual(SHIPPED);
  });
  it("qr is not in the default", () => {
    expect(DEFAULT_CHECKOUT_CHANNELS).not.toContain("qr");
  });
  it("a valid override is honoured", () => {
    expect(resolveCheckoutChannels(["card"])).toEqual(["card"]);
    expect(resolveCheckoutChannels(["ussd", "card"])).toEqual(["ussd", "card"]);
  });
  it.each([[[]], [["zap"]], [["card", "card"]], [["card", "bogus"]], ["card"], [null], [undefined], [42], [{}]])("invalid or empty %j falls back to the default", (bad) => {
    expect([...resolveCheckoutChannels(bad)]).toEqual(SHIPPED);
  });
});
