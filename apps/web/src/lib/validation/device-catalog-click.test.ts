import { describe, expect, it } from "@jest/globals";
import { deviceAffiliateClickSchema } from "./device-catalog-click";

const VALID_INPUT = {
  deviceId: "8f14e45f-ceea-467e-a5e1-01d4c8e1c2a3",
  deviceName: "Omron 10 Series Wireless Upper Arm (BP7450)",
  category: "blood_pressure",
  affiliatePartner: "jumia",
};

describe("deviceAffiliateClickSchema", () => {
  it("accepts a valid click payload", () => {
    const result = deviceAffiliateClickSchema.safeParse(VALID_INPUT);
    expect(result.success).toBe(true);
  });

  it("accepts a null affiliatePartner (a direct-manufacturer link, not Jumia/Konga)", () => {
    const result = deviceAffiliateClickSchema.safeParse({
      ...VALID_INPUT,
      affiliatePartner: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-uuid deviceId", () => {
    const result = deviceAffiliateClickSchema.safeParse({ ...VALID_INPUT, deviceId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty deviceName", () => {
    const result = deviceAffiliateClickSchema.safeParse({ ...VALID_INPUT, deviceName: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing category", () => {
    const rest: Record<string, unknown> = { ...VALID_INPUT };
    delete rest.category;
    const result = deviceAffiliateClickSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects affiliatePartner as undefined (must be explicitly null, not omitted)", () => {
    const rest: Record<string, unknown> = { ...VALID_INPUT };
    delete rest.affiliatePartner;
    const result = deviceAffiliateClickSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
