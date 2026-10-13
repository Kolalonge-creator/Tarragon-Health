/** @jest-environment node */
import { afterEach, describe, expect, it } from "@jest/globals";
import { isCronAuthorised } from "./cron-auth";

const saved = process.env.CRON_SECRET;
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("isCronAuthorised", () => {
  it("accepts only the exact bearer secret", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorised("Bearer s3cret")).toBe(true);
    expect(isCronAuthorised("Bearer s3cre")).toBe(false);
    expect(isCronAuthorised("Bearer s3cret2")).toBe(false);
    expect(isCronAuthorised("s3cret")).toBe(false);
    expect(isCronAuthorised(null)).toBe(false);
  });
  it("refuses everything when no secret is configured, even the literal word undefined", () => {
    delete process.env.CRON_SECRET;
    expect(isCronAuthorised("Bearer undefined")).toBe(false);
    expect(isCronAuthorised("Bearer ")).toBe(false);
  });
});
