/** PIN rules for the private section lock (S66). Pure. The digit counts come from PROPOSED config `private_section.lock`. */

export interface PinPolicy {
  readonly minDigits: number;
  readonly maxDigits: number;
}

export type PinProblem = "not_digits" | "too_short" | "too_long" | "same_digit" | "sequence" | "common";

const COMMON = new Set(["1234", "4321", "0000", "1212", "2580", "1004", "2000", "123456", "654321", "112233", "121212", "000000", "696969"]);

export function pinProblem(pin: string, policy: PinPolicy): PinProblem | null {
  if (!/^\d+$/.test(pin)) return "not_digits";
  if (pin.length < policy.minDigits) return "too_short";
  if (pin.length > policy.maxDigits) return "too_long";
  if (/^(\d)\1+$/.test(pin)) return "same_digit";
  const digits = [...pin].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === (digits[i - 1] as number) + 1);
  const descending = digits.every((d, i) => i === 0 || d === (digits[i - 1] as number) - 1);
  if (ascending || descending) return "sequence";
  if (COMMON.has(pin)) return "common";
  return null;
}

/** Plain-language reason for the setup screen. */
export const PIN_PROBLEM_TEXT: Record<PinProblem, string> = {
  not_digits: "Use numbers only.",
  too_short: "That PIN is too short.",
  too_long: "That PIN is too long.",
  same_digit: "Choose a PIN that is not the same number repeated.",
  sequence: "Choose a PIN that is not a run of numbers in order.",
  common: "That PIN is very common. Choose another one.",
};
