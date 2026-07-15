import { describe, expect, it } from "@jest/globals";
import { deliveryAddressSchema } from "./delivery-address";

describe("deliveryAddressSchema", () => {
  it("accepts a valid delivery address", () => {
    const result = deliveryAddressSchema.safeParse({
      street: "12 Admiralty Way",
      area: "Lekki Phase 1",
      state: "Lagos",
      phone: "+2348012345678",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a street that is too short", () => {
    const result = deliveryAddressSchema.safeParse({
      street: "1",
      area: "Lekki Phase 1",
      state: "Lagos",
      phone: "+2348012345678",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing area", () => {
    const result = deliveryAddressSchema.safeParse({
      street: "12 Admiralty Way",
      area: "",
      state: "Lagos",
      phone: "+2348012345678",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-E.164-NG phone number", () => {
    const result = deliveryAddressSchema.safeParse({
      street: "12 Admiralty Way",
      area: "Lekki Phase 1",
      state: "Lagos",
      phone: "08012345678",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing state", () => {
    const result = deliveryAddressSchema.safeParse({
      street: "12 Admiralty Way",
      area: "Lekki Phase 1",
      state: "",
      phone: "+2348012345678",
    });
    expect(result.success).toBe(false);
  });
});
