import { hitLimit } from "./row-limits";

describe("hitLimit", () => {
  it("is true at the limit, where the list may have been cut off", () => {
    expect(hitLimit(200, 200)).toBe(true);
    expect(hitLimit(201, 200)).toBe(true);
  });
  it("is false below it, where the list is whole", () => {
    expect(hitLimit(199, 200)).toBe(false);
    expect(hitLimit(0, 200)).toBe(false);
  });
  it("is false when there is no list yet", () => {
    expect(hitLimit(undefined, 200)).toBe(false);
  });
});
