import { describe, expect, it } from "@jest/globals";
import { PASSWORD_COMPLEXITY_REGEX } from "./password";

describe("PASSWORD_COMPLEXITY_REGEX", () => {
  it("accepts a password with both a letter and a digit", () => {
    expect(PASSWORD_COMPLEXITY_REGEX.test("longenough1")).toBe(true);
  });

  it("rejects a letters-only password", () => {
    expect(PASSWORD_COMPLEXITY_REGEX.test("onlyletters")).toBe(false);
  });

  it("rejects a digits-only password", () => {
    expect(PASSWORD_COMPLEXITY_REGEX.test("12345678")).toBe(false);
  });

  it("accepts a symbol mixed with a letter and a digit", () => {
    expect(PASSWORD_COMPLEXITY_REGEX.test("p@ssw0rd!")).toBe(true);
  });
});
