// The phone-code routes stay hidden unless a build explicitly opts in: an unset or mistyped variable must never show a route
// whose code can't arrive.
function load(value: string | undefined): boolean {
  const previous = process.env.EXPO_PUBLIC_TEXT_CODES_ENABLED;
  if (value === undefined) delete process.env.EXPO_PUBLIC_TEXT_CODES_ENABLED;
  else process.env.EXPO_PUBLIC_TEXT_CODES_ENABLED = value;
  let enabled = false;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    enabled = (require("./text-codes") as typeof import("./text-codes")).TEXT_CODES_ENABLED;
  });
  if (previous === undefined) delete process.env.EXPO_PUBLIC_TEXT_CODES_ENABLED;
  else process.env.EXPO_PUBLIC_TEXT_CODES_ENABLED = previous;
  return enabled;
}

describe("TEXT_CODES_ENABLED", () => {
  it("is off when the variable is unset", () => expect(load(undefined)).toBe(false));
  it("is off for anything but the exact string true", () => {
    expect(load("1")).toBe(false);
    expect(load("TRUE")).toBe(false);
    expect(load("")).toBe(false);
  });
  it("is on only for true", () => expect(load("true")).toBe(true));
});
