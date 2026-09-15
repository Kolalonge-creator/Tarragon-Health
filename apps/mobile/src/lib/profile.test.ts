/**
 * isValidE164 mirrors the server-side emergencyContactSchema regex
 * (apps/web/src/lib/validation/emergency-contact.ts) — a mismatch here would
 * let the mobile form accept a phone number the server then rejects.
 */
import { isValidE164 } from "./profile";

it("accepts a well-formed Nigerian E.164 number", () => {
  expect(isValidE164("+2348012345678")).toBe(true);
});

it("accepts surrounding whitespace", () => {
  expect(isValidE164("  +2348012345678  ")).toBe(true);
});

it.each([
  ["missing the leading +", "2348012345678"],
  ["a leading zero after +", "+0234801234"],
  ["too short", "+234801"],
  ["too long", "+234801234567890123"],
  ["contains letters", "+234801234abcd"],
  ["empty string", ""],
])("rejects %s", (_label, value) => {
  expect(isValidE164(value)).toBe(false);
});
