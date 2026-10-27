/**
 * The price-change notice (WP1, gap B2) in the bell: neutral (INV-07: no item, amount or date), calm, links to the Membership screen where the
 * details are, and the page it points at exists.
 */
import { describe, expect, it } from "@jest/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe as describeInApp } from "./describe-in-app";

describe("price_change_notice in the bell", () => {
  const out = describeInApp({ template: "price_change_notice", payload: { price_id: "p1", item_code: "membership_annual", amount: 12_900_000 } });

  it("is generic: it shows no item, no amount and no date, and is not alarming", () => {
    expect(out.text).not.toBe("You have an update");
    expect(out.text).not.toMatch(/membership|\d|₦|warning|urgent|act now|hurry/i);
    expect(out.text).toMatch(/nothing changes for you/);
  });

  it("links to the Membership screen, which exists", () => {
    expect(out.href).toBe("/patient/membership");
    expect(existsSync(join(__dirname, "..", "..", "app", "(dashboard)", "patient", "membership", "page.tsx"))).toBe(true);
  });
});
