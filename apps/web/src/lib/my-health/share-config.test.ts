import { describe, expect, it } from "@jest/globals";
import { expiryLabel, getAccessLogPageSize, getSharingConfig } from "./share-config";

describe("share config", () => {
  it("offers only choices inside the 30 day cap, and the default is one of them", () => {
    const c = getSharingConfig();
    expect(Math.max(...c.expiry_options_hours)).toBeLessThanOrEqual(c.max_expiry_hours);
    expect(c.max_expiry_hours).toBeLessThanOrEqual(720);
    expect(c.expiry_options_hours).toContain(c.default_expiry_hours);
  });

  it("labels hours and whole days", () => {
    expect(expiryLabel(1)).toBe("1 hour");
    expect(expiryLabel(12)).toBe("12 hours");
    expect(expiryLabel(24)).toBe("1 day");
    expect(expiryLabel(168)).toBe("7 days");
    expect(expiryLabel(720)).toBe("30 days");
    expect(expiryLabel(36)).toBe("36 hours");
  });

  it("has a page size", () => {
    expect(getAccessLogPageSize()).toBeGreaterThan(0);
  });
});
