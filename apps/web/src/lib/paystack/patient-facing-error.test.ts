import { toPatientFacingCheckoutError } from "./patient-facing-error";

describe("toPatientFacingCheckoutError", () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("never returns the raw provider error text", () => {
    const raw = '"email" must be a valid email';
    const result = toPatientFacingCheckoutError(raw);
    expect(result).not.toContain(raw);
    expect(result).not.toContain('"email"');
  });

  it("gives an email-specific message when the provider error mentions email", () => {
    const result = toPatientFacingCheckoutError('"email" must be a valid email');
    expect(result).toMatch(/email/i);
    expect(result).toMatch(/contact support/i);
  });

  it("falls back to a generic retry message for any other provider error", () => {
    const result = toPatientFacingCheckoutError("Internal server error");
    expect(result).toMatch(/try again/i);
  });

  it("still logs the real error server-side for diagnosis", () => {
    toPatientFacingCheckoutError("some provider failure");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[paystack]"),
      "some provider failure",
    );
  });
});
